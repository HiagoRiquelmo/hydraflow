// Subaba Descobrir: os efeitos para instalar — o pacote que vem com o app (efeitos-extras), as fontes online que a
// pessoa adicionar e os efeitos de terceiros que ela trouxe (Importar) ou desinstalou. Instalar coloca em "Todos";
// desinstalar devolve para cá; "Excluir do app" (só nos trazidos pela pessoa) apaga de vez.
// Nome e descrição de cada efeito são conteúdo da fonte (vêm como o autor escreveu); o resto da tela é traduzido.
import { app, setEffects } from '../state.js';
import { h, modal, prompt, toast, searchBox, confirmDialog, moreButton, icon as ico } from '../ui.js';
import { t, categoryLabel, catalogText } from '../i18n.js';
import * as pb from '../playback.js';
import { mountPreview, queueThumb } from '../effectPreview.js';

const nm = item => catalogText(item, 'name'), ds = item => catalogText(item, 'description');
const catalogThumb = item => queueThumb(item.thumbId, item.name, () => window.api.explore.read(item.key));

/** Baixa (ou atualiza) um efeito do catálogo. Devolve a id dele na biblioteca, ou null se falhou. */
async function installItem(item) {
  const r = await window.api.explore.install(item.key);
  if (!r.ok) { toast(r.error || t('discover.installFailed'), 'err'); return null; }
  setEffects(r.list);
  toast(t(item.installed ? 'discover.updated' : 'discover.installed', { name: nm(item) }));
  return r.effectId || null;
}

/** Prévia em tela grande. Devolve 'installed' se a pessoa instalou por ali. */
async function previewItem(item) {
  const fx = await window.api.explore.read(item.key).catch(e => { toast(e.message, 'err'); return null; });
  if (!fx) return null;
  const stage = h('div', { style: { position: 'relative', width: '640px', aspectRatio: '16/10', overflow: 'hidden', borderRadius: '14px', background: '#000' } });
  const body = h('div', { class: 'col' }, stage,
    h('div', { class: 'row' }, h('b', { class: 'grow' }, nm(item)), h('span', { class: 'dim' }, t('discover.byVersion', { publisher: item.publisher, version: item.version }))),
    h('div', { class: 'muted', style: { maxWidth: '640px' } }, ds(item) || ''),
    h('div', { class: 'dim' }, t('discover.previewNote')));
  let p;
  setTimeout(() => { p = mountPreview(stage, fx); }, 0); // o palco só tem largura depois que o modal entra na página
  const id = item.effectId;
  const action = await modal(nm(item), body, [
    { label: t('common.close'), value: () => null },
    id ? { label: t('effects.apply'), primary: true, value: () => 'apply' } : { label: t('discover.installApply'), primary: true, value: () => 'get' }
  ]);
  p?.destroy();
  if (action === 'apply' && id) pb.applyEffect(id);
  if (action === 'get') {
    const newId = await installItem(item);
    if (newId) { pb.applyEffect(newId); return 'installed'; }
  }
  return null;
}

/**
 * Cartão de um efeito do catálogo. onChange: chamado depois de instalar/atualizar (para redesenhar).
 * onLive(thumb): recebe a área da imagem para montar uma prévia ao vivo (só o destaque do Descobrir).
 */
function catalogCard(item, { onChange, badge = null, onLive } = {}) {
  const thumb = h('div', { class: 'lib-thumb', style: { cursor: 'pointer' }, title: t('discover.preview'),
    onclick: async () => { if (await previewItem(item) === 'installed') onChange?.(); } });
  const img = item.image || item.thumb;
  if (img) thumb.style.backgroundImage = `url("${img}")`;
  else {
    const ph = h('span', { class: 'ph dim' }, t('discover.makingPreview'));
    thumb.style.background = 'var(--flow-soft)';
    thumb.append(ph);
    catalogThumb(item).then(url => { if (url) thumb.style.backgroundImage = `url("${url}")`; ph.remove(); });
  }
  if (badge) thumb.append(badge);
  onLive?.(thumb);
  const install = async () => { if (await installItem(item)) onChange?.(); };
  // uma só ação por cartão: Instalar / Atualizar, ou um aviso discreto de que já está instalado
  const action = !item.installed ? h('button', { class: 'btn sm primary', onclick: install }, ico('download'), t('discover.install'))
    : item.updateAvailable ? h('button', { class: 'btn sm primary', onclick: install }, ico('refresh'), t('discover.update'))
    : h('span', { class: 'lib-owned' }, ico('check'), t('discover.owned'));
  // ⋯ no canto da imagem: pré-visualizar, instalar e, nos trazidos pela pessoa, excluir do app
  thumb.append(h('div', { class: 'thumb-tools', onclick: ev => ev.stopPropagation() }, moreButton(() => [
    { label: t('discover.preview'), action: async () => { if (await previewItem(item) === 'installed') onChange?.(); } },
    !item.installed ? { label: t('discover.install'), action: install } : null,
    ...(item.local ? ['-', { label: t('discover.deleteFromApp'), action: async () => {
      if (!await confirmDialog(t('discover.deleteFromApp'), t('discover.deleteFromAppText', { name: nm(item) }), t('common.delete'), true)) return;
      if (await window.api.explore.deleteLocal(item.key)) { toast(t('discover.deleted', { name: nm(item) })); onChange?.(); }
    } }] : [])
  ], { cls: 'star more' })));
  return h('div', { class: `card lib-card ${item.installed ? '' : 'not-installed'}` }, thumb,
    h('div', { class: 'lib-body' },
      h('div', { class: 'lib-title-row' }, h('div', { class: 'lib-title grow' }, nm(item)), action),
      h('div', { class: 'lib-desc' }, ds(item) || t('effects.noDescription'))));
}

/** Desenha o Descobrir dentro de `body`. Devolve { reload, manageSources, dispose } para o cabeçalho da aba Efeitos. */
export function discoverPane(body) {
  let cat = { sources: [], items: [] }, loaded = false, q = '', category = '', busy = false;
  let heroPreview = null;

  async function load(refresh = false) {
    try { cat = await window.api.explore.list(refresh); } // pacote que vem com o app + fontes online
    catch (e) { toast(t('discover.loadFailed', { error: e.message }), 'err'); }
    loaded = true;
    render();
  }

  async function installAll(items) {
    if (busy || !items.length) return;
    busy = true;
    body.querySelectorAll('button').forEach(b => { b.disabled = true; }); // nada de instalar outro no meio
    const btn = body.querySelector('.get-all');
    if (btn) btn.textContent = t('discover.downloading', { n: items.length });
    try {
      const r = await window.api.explore.installMany(items.map(i => i.key));
      setEffects(r.list);
      const n = r.installed.length;
      toast(r.errors.length ? t('discover.someFailed', { n, failed: r.errors.length }) : t('discover.allInstalled', { n }), r.errors.length ? 'err' : undefined);
    } catch (e) { toast(t('discover.downloadFailed', { error: e.message }), 'err'); }
    busy = false;
    await load();
  }

  function render() {
    heroPreview?.destroy(); heroPreview = null;
    body.innerHTML = '';
    if (!loaded) { body.append(h('div', { class: 'empty' }, t('discover.loading'))); return; }
    if (!cat.items.length && !cat.sources.length) {
      body.append(h('div', { class: 'empty' },
        h('div', { style: { fontSize: '18px', color: 'var(--text2)', marginBottom: '8px' } }, t('discover.noSourcesTitle')),
        t('discover.noSourcesText'),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: addSource }, ico('plus'), t('discover.addSource')))));
      return;
    }
    const failed = cat.sources.filter(s => !s.ok);
    if (failed.length) body.append(h('div', { class: 'banner err', role: 'alert' }, ico('error'), h('span', { class: 'grow' }, t('discover.sourcesDown', { names: failed.map(s => s.name).join(', ') }))));
    const updates = cat.items.filter(i => i.updateAvailable);
    if (updates.length) body.append(h('div', { class: 'banner info' }, ico('refresh'), h('span', { class: 'grow' }, t('discover.updatesAvailable', { n: updates.length })),
      h('button', { class: 'btn sm primary', onclick: async () => { for (const u of updates) await installItem(u); load(); } }, t('discover.updateAll'))));
    // destaque: o primeiro ainda não instalado toca ao vivo dentro do próprio cartão
    const featuredKey = cat.items.find(i => !i.installed)?.key || null;
    const grid = h('div', { class: 'lib-grid' });
    const cats = [...new Set(cat.items.map(i => i.category).filter(Boolean))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
    // "Baixar todos" vale para o que está na tela (respeita a busca e a categoria)
    let missing = [];
    const getAll = h('button', { class: 'btn primary get-all', onclick: () => installAll(missing) });
    const owned = h('span', { class: 'lib-owned', hidden: true });
    body.append(h('div', { class: 'toolbar compact' },
      searchBox(q, t('effects.search'), v => { q = v; draw(); }),
      cats.length > 1 ? h('select', { class: 'input', 'aria-label': t('effects.category'), onchange: e => { category = e.target.value; draw(); } },
        h('option', { value: '' }, t('effects.allCategories')), cats.map(c => h('option', { value: c, selected: category === c }, categoryLabel(c)))) : null,
      h('span', { class: 'grow' }), getAll, owned), grid);
    function draw() {
      const ql = q.trim().toLowerCase();
      // o que já foi baixado sai daqui e fica em "Todos" (só volta a aparecer se ganhar versão nova)
      const list = cat.items.filter(i => (!i.installed || i.updateAvailable) && (!category || i.category === category) && (!ql || `${nm(i)} ${i.name} ${i.publisher} ${ds(i)} ${i.tags.join(' ')}`.toLowerCase().includes(ql)))
        .sort((a, b) => (a.installed - b.installed) || nm(a).localeCompare(nm(b)));
      missing = list.filter(i => !i.installed);
      getAll.replaceChildren(ico('download'), t(category || ql ? 'discover.getThese' : 'discover.getAll', { n: missing.length }));
      getAll.hidden = !missing.length;
      owned.hidden = !!missing.length || !!(category || ql);
      const fi = list.findIndex(i => i.key === featuredKey);
      if (fi > 0) list.unshift(list.splice(fi, 1)[0]);
      heroPreview?.destroy(); heroPreview = null;
      grid.innerHTML = '';
      if (!list.length) grid.append(h('div', { class: 'empty' }, !cat.items.length ? t('discover.sourcesEmpty')
        : category || ql ? t('discover.noneFound') : t('discover.allOwned')));
      for (const i of list) {
        const featured = i.key === featuredKey;
        grid.append(catalogCard(i, {
          onChange: () => load(),
          badge: featured ? h('span', { class: 'badge chip featured' }, ico('star', 'fill'), t('discover.featured')) : null,
          onLive: featured ? thumb => window.api.explore.read(i.key).then(fx => {
            if (!thumb.isConnected) return;
            heroPreview?.destroy();
            const live = h('div', { style: { position: 'absolute', inset: '0', overflow: 'hidden' } });
            thumb.prepend(live);
            heroPreview = mountPreview(live, fx, 'cover');
          }).catch(e => console.warn('Prévia do destaque:', e)) : null // a imagem estática continua no lugar
        }));
      }
    }
    draw();
  }

  async function addSource() {
    const url = await prompt(t('discover.addSourceTitle'), { label: t('discover.indexLink'), placeholder: 'https://raw.githubusercontent.com/usuario/repo/main/index.json', validate: v => !/^https:\/\//.test(v) ? t('discover.needHttps') : null });
    if (!url) return false;
    const r = await window.api.explore.addSource(url);
    if (!r.ok) { toast(t('discover.sourceFailed', { error: r.error }), 'err'); return false; }
    app.store.exploreSources = r.sources;
    toast(t('discover.sourceAdded'));
    await load(true);
    return true;
  }

  async function manageSources() {
    const box = h('div', { class: 'col', style: { width: '620px' } });
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'dim' }, t('discover.sourcesExplain')));
      if (!cat.sources.length) box.append(h('div', { class: 'dim' }, t('discover.noSourcesAdded')));
      for (const s of cat.sources) {
        box.append(h('div', { class: 'pl-row' },
          h('div', { class: 'grow' }, h('div', {}, s.name), h('div', { class: 'dim', style: { wordBreak: 'break-all' } }, s.url)),
          h('span', { class: `chip ${s.ok ? (s.offline ? 'warn' : 'ok') : 'err'}` }, s.ok ? (s.offline ? t('discover.offline') : t('effects.effectCount', { n: s.count })) : t('discover.error')),
          h('button', { class: 'btn sm danger', onclick: async () => { app.store.exploreSources = await window.api.explore.removeSource(s.url); await load(); draw(); } }, t('common.remove'))));
      }
      box.append(h('button', { class: 'btn primary', onclick: async () => { if (await addSource()) draw(); } }, t('discover.addSourcePlus')));
    };
    draw();
    await modal(t('discover.sourcesTitle'), box, [{ label: t('common.close'), primary: true }]);
  }

  render();
  load();
  return { reload: () => load(true), manageSources, dispose: () => heroPreview?.destroy() };
}
