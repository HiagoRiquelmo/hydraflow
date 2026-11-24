'use strict';
// Biblioteca de mídia do Hydraflow: imagens, GIFs e vídeos usados pelo papel de parede e pela tela do watercooler.
// Os arquivos são COPIADOS para %APPDATA%\Hydraflow\biblioteca (apagar ou mover o original não afeta o app) com o nome
// pelo conteúdo (SHA-256): importar o mesmo arquivo de novo não duplica. O índice (biblioteca.json) guarda o nome
// original, o tipo, o tamanho e a data. Quem usa um arquivo guarda o caminho dele dentro da biblioteca.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const VIDEO = ['.mp4', '.webm', '.mov', '.m4v'];
const ANIMATED = ['.gif', '.webp', '.apng'];
const STILL = ['.png', '.jpg', '.jpeg', '.bmp'];
const EXTS = [...VIDEO, ...ANIMATED, ...STILL];
// tipo mostrado na biblioteca (WebP/APNG podem ser parados; contam como "animada" para o filtro)
const kindOf = ext => (VIDEO.includes(ext) ? 'video' : ANIMATED.includes(ext) ? 'animated' : 'image');

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

class Library {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'biblioteca');
    this.thumbDir = path.join(this.dir, 'miniaturas');
    this.indexFile = path.join(this.dir, 'biblioteca.json');
    fs.mkdirSync(this.thumbDir, { recursive: true });
    this.items = this.load();
    this.queue = Promise.resolve(); // uma importação por vez (o índice é lido e regravado)
  }

  load() {
    if (!fs.existsSync(this.indexFile)) return [];
    try {
      const list = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      // arquivo apagado por fora: some da lista em vez de aparecer quebrado
      return Array.isArray(list) ? list.filter(i => fs.existsSync(this.fileOf(i))) : [];
    } catch (e) {
      // ilegível: guarda o original ao lado (a próxima gravação regravaria o índice vazio e a biblioteca sumiria)
      console.error('biblioteca.json ilegível, guardado como .bad:', e.message);
      try { fs.renameSync(this.indexFile, this.indexFile + '.bad'); } catch {}
      return [];
    }
  }
  save() {
    const tmp = this.indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 1));
    fs.renameSync(tmp, this.indexFile);
  }

  fileOf(item) { return path.join(this.dir, item.id + item.ext); }
  thumbOf(item) { return path.join(this.thumbDir, item.id + '.png'); }
  get(id) { return this.items.find(i => i.id === id) || null; }
  /** Item da biblioteca que corresponde a um caminho (de quem usa: papel de parede, cooler), ou null. */
  byPath(file) {
    if (!file) return null;
    const p = path.resolve(file).toLowerCase();
    return this.items.find(i => path.resolve(this.fileOf(i)).toLowerCase() === p) || null;
  }
  isInside(file) { return !!file && path.resolve(file).toLowerCase().startsWith(path.resolve(this.dir).toLowerCase() + path.sep); }

  /** Lista para a janela: com URLs file:// do arquivo e da miniatura (se já gerada). */
  list() {
    return this.items.map(i => {
      const thumb = this.thumbOf(i);
      return { ...i, url: pathToFileURL(this.fileOf(i)).href, thumb: fs.existsSync(thumb) ? pathToFileURL(thumb).href : null };
    }).sort((a, b) => b.addedAt - a.addedAt);
  }
  totalBytes() { return this.items.reduce((a, i) => a + (i.size || 0), 0); }

  /**
   * Copia arquivos para a biblioteca. Devolve { added: [id], duplicates: [id], skipped: [{ file, reason }] }.
   * reason: 'type' (formato não suportado) | 'missing' | 'error'.
   */
  add(files) {
    const run = this.queue.then(() => this.addNow(files));
    this.queue = run.catch(() => {});
    return run;
  }
  async addNow(files) {
    const out = { added: [], duplicates: [], skipped: [] };
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!EXTS.includes(ext)) { out.skipped.push({ file, reason: 'type' }); continue; }
      try {
        const st = await fs.promises.stat(file);
        if (!st.isFile()) { out.skipped.push({ file, reason: 'missing' }); continue; }
        const id = (await hashFile(file)).slice(0, 24);
        if (this.get(id)) { out.duplicates.push(id); continue; } // mesmo conteúdo já está aqui
        const item = { id, ext, name: path.basename(file, path.extname(file)), kind: kindOf(ext), size: st.size, addedAt: Date.now() };
        await fs.promises.copyFile(file, this.fileOf(item));
        this.items.push(item);
        this.save();
        out.added.push(id);
      } catch { out.skipped.push({ file, reason: 'error' }); }
    }
    return out;
  }

  /** Miniatura gerada pela janela (PNG em data URL): imagens animadas aparecem paradas na grade (não gastam CPU). */
  saveThumb(id, dataUrl) {
    const item = this.get(id);
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
    if (!item || !m) return null;
    fs.writeFileSync(this.thumbOf(item), Buffer.from(m[1], 'base64'));
    return pathToFileURL(this.thumbOf(item)).href;
  }

  rename(id, name) {
    const item = this.get(id);
    if (!item || !String(name || '').trim()) return false;
    item.name = String(name).trim().slice(0, 120);
    this.save();
    return true;
  }

  /** Apaga o arquivo e a miniatura. Quem chama confere antes se ele está em uso. */
  remove(id) {
    const item = this.get(id);
    if (!item) return false;
    for (const f of [this.fileOf(item), this.thumbOf(item)]) { try { fs.rmSync(f, { force: true }); } catch {} }
    this.items = this.items.filter(i => i !== item);
    this.save();
    return true;
  }
}

module.exports = { Library, EXTS, VIDEO, ANIMATED, STILL };
