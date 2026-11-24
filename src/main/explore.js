'use strict';
// Catálogos de efeitos para instalar: o pacote de extras que vem com o app (na pasta efeitos-extras)
// e as fontes online que a pessoa adicionar (index.json publicado em https).
// Formato do índice:
// { "name": "...", "description": "...", "effects": [ { "id", "name", "publisher", "description",
//   "category", "tags": [], "version": "1.0.0", "file": "efeitos/x.html", "image": "imagens/x.png", "updated": "2026-01-01" } ] }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { parseEffect, findImage, IMAGE_EXTS } = require('./effects');

const EXTRAS_SOURCE = 'extras'; // chave da fonte "pacote de extras" (estável entre instalações; o caminho muda)
// Efeitos de terceiros que a pessoa trouxe de um arquivo (Importar) ou desinstalou: ficam guardados pelo app e aparecem
// no Descobrir; instalar copia para a biblioteca, desinstalar devolve ao Descobrir, "Excluir do app" apaga de vez.
const LOCAL_SOURCE = 'local';
const MAX_HTML = 2 * 1024 * 1024;
const MAX_IMG = 4 * 1024 * 1024;

function cmpVersion(a = '0', b = '0') {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

const slug = s => String(s || 'efeito').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'efeito';

class Explore {
  constructor({ net, dataDir, bundledDir, t = k => k }) {
    this.t = t; // mensagens de erro no idioma do app
    this.net = net;
    this.bundledIndex = bundledDir ? path.join(bundledDir, 'index.json') : null;
    this.cacheDir = path.join(dataDir, 'explore-cache');
    this.localDir = path.join(dataDir, 'efeitos-recebidos');
    this.installedFile = path.join(dataDir, 'explore-installed.json');
    this.items = new Map();
    this.queue = Promise.resolve();
    this.remoteCache = new Map(); // url -> { at, index }
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.localDir, { recursive: true });
  }

  /** Guarda efeitos (e a capa de mesmo nome) entre os recebidos, com nome de arquivo livre. Devolve os arquivos guardados. */
  keepLocal(files) {
    // o mesmo efeito importado de novo não vira "Nome (2)": conteúdo igual a um já guardado é ignorado
    const same = html => fs.readdirSync(this.localDir).some(n => /\.html?$/i.test(n) && fs.readFileSync(path.join(this.localDir, n), 'utf8') === html);
    return files.filter(f => !same(fs.readFileSync(f, 'utf8'))).map(f => {
      const ext = path.extname(f), base = path.basename(f, ext);
      let dest = path.join(this.localDir, base + '.html');
      for (let n = 2; fs.existsSync(dest); n++) dest = path.join(this.localDir, `${base} (${n}).html`);
      fs.copyFileSync(f, dest);
      const img = findImage(f);
      if (img) fs.copyFileSync(img, dest.replace(/\.html$/i, path.extname(img).toLowerCase()));
      return dest;
    });
  }
  /** O arquivo instalado veio do Descobrir (de qualquer fonte)? Se não veio, desinstalar o guarda entre os recebidos. */
  tracks(file) {
    const p = path.resolve(file).toLowerCase();
    return Object.values(this.installed()).some(v => path.resolve(v.file).toLowerCase() === p);
  }
  /** "Excluir do app": apaga um recebido (e a capa). */
  deleteLocal(key) {
    const it = this.items.get(key);
    if (!it?.local) return false;
    const file = fileURLToPath(it.src);
    for (const f of [file, findImage(file)].filter(Boolean)) fs.rmSync(f, { force: true });
    const m = this.installed();
    if (m[key]) { delete m[key]; this.saveInstalled(m); }
    return true;
  }

  installed() {
    if (!fs.existsSync(this.installedFile)) return {};
    try { return JSON.parse(fs.readFileSync(this.installedFile, 'utf8')); }
    catch (e) {
      // ilegível: guarda o original ao lado (a próxima instalação regravaria o arquivo e o registro das outras sumiria)
      console.error('explore-installed.json ilegível, guardado como .bad:', e.message);
      fs.renameSync(this.installedFile, this.installedFile + '.bad');
      return {};
    }
  }
  /** Efeitos instalados do pacote que vem com o app: [{ file, extrasId }] (nome e descrição traduzidos em locales/extras). */
  installedExtras() {
    const prefix = `${EXTRAS_SOURCE}::`;
    return Object.entries(this.installed()).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ file: v.file, extrasId: k.slice(prefix.length) }));
  }
  saveInstalled(m) { fs.writeFileSync(this.installedFile, JSON.stringify(m, null, 1)); }
  forgetFile(file) {
    const m = this.installed();
    for (const [k, v] of Object.entries(m)) if (path.resolve(v.file).toLowerCase() === path.resolve(file).toLowerCase()) delete m[k];
    this.saveInstalled(m);
  }

  /** Lê um arquivo do catálogo: do disco (pacote de extras, file://) ou da internet. */
  async fetchBuf(url, max) {
    if (url.startsWith('file:')) return fs.readFileSync(fileURLToPath(url));
    const r = await this.net.fetch(url, { headers: { 'User-Agent': 'Hydraflow' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len && len > max) throw new Error(this.t('explore.tooBig'));
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error(this.t('explore.tooBig'));
    return buf;
  }

  async fetchIndex(url) {
    const buf = await this.fetchBuf(url, MAX_HTML);
    const index = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(index.effects)) throw new Error(this.t('explore.badIndex'));
    return index;
  }

  cacheFileFor(url) { return path.join(this.cacheDir, crypto.createHash('sha1').update(url).digest('hex') + '.json'); }

  async loadRemote(url, refresh) {
    const c = this.remoteCache.get(url);
    if (c && !refresh && Date.now() - c.at < 30 * 60 * 1000) return { index: c.index, ok: true };
    try {
      const index = await this.fetchIndex(url);
      this.remoteCache.set(url, { at: Date.now(), index });
      fs.writeFileSync(this.cacheFileFor(url), JSON.stringify(index));
      return { index, ok: true };
    } catch (e) {
      try { return { index: JSON.parse(fs.readFileSync(this.cacheFileFor(url), 'utf8')), ok: true, offline: true, error: e.message }; }
      catch { return { index: null, ok: false, error: e.message }; }
    }
  }

  /**
   * effectIdFor(file): id do efeito na biblioteca para um arquivo instalado (ou null).
   * thumbFor(thumbId): URL da miniatura já gerada para o item (ou null).
   */
  async list(remoteUrls = [], refresh = false, { effectIdFor = () => null, thumbFor = () => null } = {}) {
    const items = new Map(); // trocado no fim: uma instalação em andamento continua achando o item durante a busca
    const out = { sources: [], items: [] };
    const inst = this.installed();
    // srcKey: identidade estável da fonte (o caminho do pacote de extras muda entre instalações; a chave não)
    const add = (srcUrl, srcName, e, srcKey = srcUrl) => {
      if (!e || !e.id || !e.file || !e.name) return;
      const key = `${srcKey}::${e.id}`;
      const item = {
        key, source: srcName, id: String(e.id), name: String(e.name), publisher: String(e.publisher || this.t('explore.unknownPublisher')),
        description: String(e.description || ''), category: String(e.category || ''), tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
        version: String(e.version || '1.0.0'), updated: e.updated || '', image: e.image ? new URL(e.image, srcUrl).href : null,
        src: new URL(e.file, srcUrl).href
      };
      item.bundled = srcKey === EXTRAS_SOURCE;
      item.local = srcKey === LOCAL_SOURCE;
      item.thumbId = `explore:${key}:${item.version}`;
      item.thumb = item.image ? null : thumbFor(item.thumbId);
      const i = inst[key];
      item.installed = !!(i && fs.existsSync(i.file));
      item.installedVersion = i?.version || null;
      item.updateAvailable = item.installed && cmpVersion(item.version, i.version) > 0;
      item.effectId = item.installed ? effectIdFor(i.file) : null;
      items.set(key, item);
      const { src, ...pub } = item;
      out.items.push(pub);
    };
    // extras que vêm com o app: não são uma "fonte" que a pessoa gerencia, só itens prontos para instalar
    if (this.bundledIndex && fs.existsSync(this.bundledIndex)) {
      try {
        const idx = JSON.parse(fs.readFileSync(this.bundledIndex, 'utf8'));
        for (const e of idx.effects) add(pathToFileURL(this.bundledIndex).href, idx.name || 'Hydraflow', e, EXTRAS_SOURCE);
      } catch (e) { console.error('Efeitos extras:', e.message); }
    }
    // recebidos: o próprio arquivo diz nome, autor e descrição; a capa é a imagem de mesmo nome
    for (const name of fs.readdirSync(this.localDir).filter(f => /\.html?$/i.test(f))) {
      const file = path.join(this.localDir, name);
      try {
        const meta = parseEffect(fs.readFileSync(file, 'utf8'));
        const img = findImage(file);
        add(pathToFileURL(file).href, this.t('explore.localSource'), {
          id: name, file: name, name: meta.title || path.basename(name, path.extname(name)), publisher: meta.publisher,
          description: meta.description, image: img ? path.basename(img) : null
        }, LOCAL_SOURCE);
      } catch (e) { console.warn('Efeito recebido inválido', name, e.message); }
    }
    const results = await Promise.all(remoteUrls.map(u => this.loadRemote(u, refresh).then(r => [u, r])));
    for (const [u, r] of results) {
      out.sources.push({ url: u, name: r.index?.name || u, ok: r.ok, offline: !!r.offline, error: r.error, count: r.index?.effects?.length || 0 });
      if (r.index) for (const e of r.index.effects) add(u, r.index.name || u, e);
    }
    this.items = items;
    return out;
  }

  async readHtml(key) {
    const it = this.items.get(key);
    if (!it) throw new Error(this.t('explore.notFound'));
    return (await this.fetchBuf(it.src, MAX_HTML)).toString('utf8');
  }

  /** HTML para prévia + valores padrão dos parâmetros declarados. */
  async readEffect(key) {
    const html = await this.readHtml(key);
    return { html, params: Object.fromEntries(parseEffect(html).properties.map(p => [p.property, p.default])) };
  }

  // uma instalação por vez: cada uma lê e regrava explore-installed.json e escolhe um nome de arquivo livre
  install(key, destDir) {
    const run = this.queue.then(() => this.installNow(key, destDir));
    this.queue = run.catch(() => {});
    return run;
  }

  async installNow(key, destDir) {
    const it = this.items.get(key);
    if (!it) return { ok: false, error: this.t('explore.notFound') };
    try {
      const html = await this.readHtml(key);
      if (!/<canvas/i.test(html)) return { ok: false, error: this.t('explore.notEffect') };
      const inst = this.installed();
      let file = inst[key]?.file;
      if (!file || !fs.existsSync(file)) {
        const base = slug(it.name);
        file = path.join(destDir, base + '.html');
        for (let n = 2; fs.existsSync(file); n++) file = path.join(destDir, `${base} (${n}).html`);
      }
      fs.writeFileSync(file, html);
      // imagem de capa com o mesmo nome do arquivo
      if (it.image) {
        try {
          const ext = (path.extname(new URL(it.image).pathname) || '.png').toLowerCase();
          if (IMAGE_EXTS.includes(ext)) {
            fs.writeFileSync(file.replace(/\.html$/i, ext), await this.fetchBuf(it.image, MAX_IMG));
          }
        } catch {}
      }
      inst[key] = { file, version: it.version, installedAt: new Date().toISOString() };
      this.saveInstalled(inst);
      return { ok: true, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { Explore };
