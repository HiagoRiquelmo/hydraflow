'use strict';
// Catálogo de efeitos: arquivos .html com <canvas> e parâmetros declarados em <meta property=...>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const fileUrl = p => pathToFileURL(p).href;

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : undefined;
}

function convertValue(type, raw) {
  if (raw === undefined) return undefined;
  switch (type) {
    case 'number': case 'hue': { const n = Number(raw); return Number.isFinite(n) ? n : 0; }
    case 'boolean': return raw === true || raw === '1' || String(raw).toLowerCase() === 'true';
    default: return String(raw);
  }
}

function parseEffect(html) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html])[0];
  const title = ((head.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const metas = head.match(/<meta\b[\s\S]*?>/gi) || [];
  let description = '', publisher = '';
  const properties = [];
  for (const tag of metas) {
    const prop = attr(tag, 'property');
    if (prop) {
      const type = (attr(tag, 'type') || 'textfield').toLowerCase();
      const num = name => attr(tag, name) !== undefined ? Number(attr(tag, name)) : undefined;
      const p = { property: prop, label: attr(tag, 'label') || prop, type, min: num('min'), max: num('max'), step: num('step'), tooltip: attr(tag, 'tooltip') || '' };
      const values = attr(tag, 'values');
      if (values !== undefined) p.values = values.split(',').map(s => s.trim()).filter(Boolean);
      p.default = convertValue(type, attr(tag, 'default'));
      if (p.default === undefined) p.default = type === 'boolean' ? false : type === 'number' || type === 'hue' ? (p.min ?? 0) : type === 'color' ? '#ffffff' : (p.values?.[0] ?? '');
      properties.push(p);
      continue;
    }
    if (attr(tag, 'description') !== undefined) description = attr(tag, 'description');
    if (attr(tag, 'publisher') !== undefined) publisher = attr(tag, 'publisher');
  }
  // <meta screen-capture="true" />: o app captura a tela em vez de rodar o canvas (Ambiente da Tela)
  const screenCapture = metas.some(tag => attr(tag, 'screen-capture') === 'true');
  return { title, description, publisher, properties, screenCapture };
}

/**
 * Imagem de capa: arquivo de imagem com o mesmo nome do efeito, na mesma pasta. listing: nomes da pasta já lidos
 * (a varredura do catálogo lê cada pasta uma vez só, em vez de uma vez por efeito).
 */
function findImage(file, listing) {
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file)).toLowerCase();
  try {
    for (const f of listing || fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      if (IMAGE_EXTS.includes(ext) && path.basename(f, ext).toLowerCase() === base) return path.join(dir, f);
    }
  } catch {}
  return null;
}

function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

class EffectCatalog {
  /** sources: [{ key, dir, removable }]; thumbDir: miniaturas geradas pelo app; userDir: pasta dos efeitos instalados pela pessoa */
  constructor(sources, { thumbDir, userDir } = {}) { this.sources = sources; this.thumbDir = thumbDir; this.userDir = userDir; this.byId = new Map(); }

  thumbFile(id) { return path.join(this.thumbDir, crypto.createHash('sha1').update(String(id)).digest('hex') + '.png'); }
  thumbUrl(id) { if (!this.thumbDir) return null; const f = this.thumbFile(id); return fs.existsSync(f) ? fileUrl(f) : null; }

  /** Grava a miniatura (PNG em data URL) e devolve a URL file:// dela. */
  saveThumb(id, dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null;
    const file = this.thumbFile(id);
    fs.mkdirSync(this.thumbDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return fileUrl(file);
  }

  scan() {
    this.byId.clear();
    const listings = new Map();
    const listing = dir => { if (!listings.has(dir)) { try { listings.set(dir, fs.readdirSync(dir)); } catch { listings.set(dir, []); } } return listings.get(dir); };
    for (const src of this.sources) {
      for (const file of walk(src.dir)) {
        try {
          const meta = parseEffect(fs.readFileSync(file, 'utf8'));
          const rel = path.relative(src.dir, file).split(path.sep).join('/');
          const id = `${src.key}:${rel}`;
          const img = findImage(file, listing(path.dirname(file)));
          const thumb = img ? null : this.thumbUrl(id);
          this.byId.set(id, {
            id,
            file,
            source: src.key,
            removable: !!src.removable,
            name: meta.title || path.basename(file, path.extname(file)),
            description: meta.description,
            publisher: meta.publisher || 'Desconhecido',
            properties: meta.properties,
            screen: meta.screenCapture && src.key === 'builtin', // só o que vem com o app pode capturar a tela
            category: rel.includes('/') ? rel.split('/')[0] : '',
            image: img ? fileUrl(img) : null,
            thumb,
            mtime: fs.statSync(file).mtimeMs
          });
        } catch (e) {
          console.warn('Efeito inválido', file, e.message);
        }
      }
    }
    return this.list();
  }

  list() { return [...this.byId.values()].map(({ file, ...rest }) => rest); }
  read(id) { const e = this.byId.get(id); return e ? fs.readFileSync(e.file, 'utf8') : null; }
  idForFile(file) { for (const e of this.byId.values()) if (path.resolve(e.file) === path.resolve(file)) return e.id; return null; }

  /**
   * Apaga um efeito removível e a imagem de capa dele. before(file) roda antes de apagar (o principal guarda ali
   * entre os recebidos o que não veio do Descobrir). Devolve o arquivo apagado.
   */
  remove(id, before = () => {}) {
    const e = this.byId.get(id);
    if (!e || !e.removable) throw Object.assign(new Error('not removable'), { code: 'not-removable' }); // o principal traduz
    before(e.file);
    fs.rmSync(e.file, { force: true });
    if (e.image) fs.rmSync(fileURLToPath(e.image), { force: true });
    return e.file;
  }
}

module.exports = { EffectCatalog, parseEffect, findImage, IMAGE_EXTS, fileUrl };
