'use strict';
// Migrações de dados de versões antigas. Cada uma confere se ainda há algo a migrar e não faz nada se não houver;
// nenhuma impede o app de abrir (quem chama registra o erro e segue).
const fs = require('fs');
const path = require('path');

/** "RGB Studio" virou "Hydraflow": pasta em Documentos e dados do app. Roda antes de o store existir. */
function fromRgbStudio({ app, dataDir }) {
  try {
    const oldDocs = path.join(app.getPath('documents'), 'RGBStudio');
    const newDocs = path.join(app.getPath('documents'), 'Hydraflow');
    if (fs.existsSync(oldDocs) && !fs.existsSync(newDocs)) {
      fs.renameSync(oldDocs, newDocs);
      // efeitos obtidos antes da mudança de nome ainda citam o autor antigo
      const dir = path.join(newDocs, 'Effects');
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (!/\.html?$/i.test(f)) continue;
        const p = path.join(dir, f);
        const text = fs.readFileSync(p, 'utf8');
        if (text.includes('<meta publisher="RGB Studio"')) fs.writeFileSync(p, text.replace('<meta publisher="RGB Studio"', '<meta publisher="Hydraflow"'));
      }
    }
    const oldData = path.join(app.getPath('appData'), 'RGB Studio');
    if (fs.existsSync(path.join(oldData, 'config.json')) && !fs.existsSync(path.join(dataDir, 'config.json'))) {
      fs.mkdirSync(dataDir, { recursive: true });
      for (const item of ['config.json', 'thumbs', 'explore-installed.json', 'explore-cache']) {
        const src = path.join(oldData, item);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(dataDir, item), { recursive: true });
      }
      // caminhos absolutos gravados com o nome antigo
      for (const f of ['config.json', 'explore-installed.json']) {
        const p = path.join(dataDir, f);
        if (!fs.existsSync(p)) continue;
        const text = fs.readFileSync(p, 'utf8').split(JSON.stringify(oldDocs).slice(1, -1)).join(JSON.stringify(newDocs).slice(1, -1));
        fs.writeFileSync(p, text);
      }
    }
  } catch (e) { console.error('Migração (RGB Studio):', e.message); }
}

/**
 * Até a 0.9 o papel de parede guardava só o caminho dos arquivos escolhidos (sumiam se o original fosse movido) e o
 * cooler apontava para o arquivo original. Copia tudo para a biblioteca uma vez e passa a apontar para a cópia.
 * Os originais não são tocados.
 */
async function mediaToLibrary({ store, library }) {
  const w = store.get('wallpaper'), c = store.get('cooler');
  const outside = [...new Set([...(w.list || []), w.file, c.image].filter(f => f && !library.isInside(f) && fs.existsSync(f)))];
  if (!outside.length && !('list' in w)) return;
  const copyOf = {};
  for (const f of outside) {
    const r = await library.add([f]);
    const id = r.added[0] || r.duplicates[0];
    if (id) copyOf[f] = library.fileOf(library.get(id));
  }
  const next = { ...w, file: copyOf[w.file] || (w.file && fs.existsSync(w.file) ? w.file : null) };
  delete next.list;
  store.set('wallpaper', next);
  if (c.image && copyOf[c.image]) store.set('cooler.image', copyOf[c.image]);
}

/**
 * Até a 0.10 a id de uma fita WLED levava o IP com os pontos ("wled:192.168.0.5"); o store usa "." como separador de
 * caminho, então os ajustes dela nunca eram achados. Agora é "wled:192_168_0_5": a posição nos layouts acompanha.
 */
function wledIds({ store }) {
  const fix = items => {
    let changed = false;
    for (const id of Object.keys(items || {})) {
      if (!id.startsWith('wled:') || !id.includes('.')) continue;
      const to = id.replace(/[.\s]/g, '_');
      if (!(to in items)) items[to] = items[id];
      delete items[id];
      changed = true;
    }
    return changed;
  };
  const layouts = store.get('layouts');
  let changed = fix(layouts.working?.items);
  for (const l of Object.values(layouts.list || {})) changed = fix(l.items) || changed;
  if (changed) store.set('layouts', layouts);
}

module.exports = { fromRgbStudio, mediaToLibrary, wledIds };
