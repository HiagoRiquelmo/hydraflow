// Biblioteca de efeitos: os efeitos instalados (a Cor Sólida, os importados e os baixados no Descobrir),
// os favoritos, as playlists e o Descobrir. Desde a 1.0 mora dentro de Iluminação → Efeitos (embedded: sem o
// título de página, logo abaixo da prévia do efeito que está tocando, com cartões em pé).
import { app, on, set, get, effectById, fxImage, navigate, setEffects } from '../state.js';
import { h, modal, prompt, confirmDialog, toast, contextMenu, moreButton, searchBox, requiredName, icon as ico } from '../ui.js';
import { t, fxName, fxDescription, categoryLabel } from '../i18n.js';
import * as pb from '../playback.js';
import { queueThumb } from '../effectPreview.js';
import { discoverPane } from './discover.js';
import { playlists, savePlaylists, forgetEffect, createPlaylist, deletePlaylist, addToPlaylistDialog } from '../playlists.js';

// efeito importado sem imagem: gera uma em segundo plano
const libraryThumb = e => queueThumb(e.id, e.name, async () => ({
  html: await window.api.effects.read(e.id),
  params: Object.fromEntries(e.properties.map(p => [p.property, p.default]))
})).then(url => { if (url) { e.thumb = url; e.thumbV = Date.now(); } return url && fxImage(e); });

const TABS = ['all', 'fav', 'playlists', 'discover'];
// a biblioteca da aba Efeitos: o Ambiente da Tela tem aba própria e não entra aqui (nem em playlists)
const library = () => app.effects.filter(e => !e.screen);

export function renderEffects(root, { embedded = false } = {}) {
  const subs = [];
  const sub = (e, f) => subs.push(on(e, f));
  let tab = TABS.includes(app.store.ui.effectsTab) ? app.store.ui.effectsTab : 'all';
  const st = { q: '', cat: '', pl: null };
  let discover = null; // painel do Descobrir enquanto essa subaba está aberta

  function render() {
    discover?.dispose(); discover = null;
    root.innerHTML = '';
    const counts = { all: library().length, fav: library().filter(e => pb.isFavorite(e.id)).length, playlists: playlists().length };
    const subtitle = { playlists: t('effects.subPlaylists'), discover: t('effects.subDiscover') }[tab] || t('effects.subAll');
    const more = items => moreButton(items, { cls: 'btn icon ghost', alignRight: true });
    const actions = {
      playlists: h('button', { class: 'btn sm primary', onclick: newPlaylist }, ico('plus'), t('effects.newPlaylist')),
      discover: more([
        { label: t('effects.import'), action: importFile },
        { label: t('effects.refresh'), action: () => discover?.reload() },
        { label: t('effects.sources'), action: () => discover?.manageSources() }])
    }[tab] || more([
      { label: t('effects.import'), action: importFile },
      { label: t('effects.openFolder'), action: () => window.api.effects.openFolder() }]);
    const page = h('div', { class: `page ${embedded ? 'lib-embedded' : ''}` },
      h('div', { class: 'page-head compact' },
        embedded ? null : h('h1', {}, t('effects.title')),
        h('div', { class: 'tabs' }, TABS.map(k => h('button', {
          class: `tab ${tab === k ? 'active' : ''}`, 'aria-pressed': String(tab === k),
          onclick: () => { tab = k; set('ui.effectsTab', k, { silent: true }); render(); }
        }, t(`effects.tab.${k}`), k in counts ? h('span', { class: 'n' }, counts[k]) : null))),
        h('div', { class: 'grow' }),
        actions),
      h('div', { class: 'page-sub', style: { padding: '0 28px 4px' } }, subtitle));
    const body = h('div', { class: 'page-body' });
    page.append(body);
    root.append(page);
    if (tab === 'playlists') renderPlaylists(body);
    else if (tab === 'discover') discover = discoverPane(body);
    else renderGrid(body);
  }

  // efeito de terceiro entra pelo Descobrir: a pessoa vê a prévia e decide instalar
  async function importFile() {
    const r = await window.api.effects.import();
    if (!r.imported?.length) { if (r.repeated) toast(t('effects.alreadyImported')); return; }
    toast(t('effects.imported', { n: r.imported.length }));
    if (tab === 'discover') discover?.reload();
    else { tab = 'discover'; set('ui.effectsTab', 'discover', { silent: true }); render(); }
  }

  function effectCard(e) {
    const active = get('activeEffect') === e.id;
    const fav = pb.isFavorite(e.id);
    const img = fxImage(e);
    const name = fxName(e);
    // clicar no cartão aplica; se já está tocando, abre os ajustes na Iluminação
    const apply = () => {
      // já tocando: dentro da Iluminação, sobe até a prévia e os ajustes; fora dela, abre a Iluminação
      if (active) return embedded ? root.closest('.lt-main')?.scrollTo({ top: 0, behavior: 'smooth' }) : navigate('lighting', { tab: 'effects' });
      pb.applyEffect(e.id); toast(t('effects.applied', { name })); render();
    };
    const menuItems = () => [
      { label: active ? t('effects.adjust') : t('effects.apply'), action: apply },
      { label: t('effects.addToPlaylist'), action: () => addToPlaylistDialog(e.id) },
      ...(e.removable ? ['-', { label: t('effects.uninstall'), action: () => uninstall(e) }] : [])];
    const initials = img ? null : h('span', { class: 'lib-initials', 'aria-hidden': 'true' }, name.slice(0, 2).toUpperCase());
    const thumb = h('div', { class: 'lib-thumb', style: img ? { backgroundImage: `url("${img}")` } : { background: 'var(--flow-soft)' } },
      initials,
      h('div', { class: 'thumb-tools' },
        h('button', { class: `star ${fav ? 'on' : ''}`, title: fav ? t('effects.unfavorite') : t('effects.favorite'), 'aria-pressed': String(fav), onclick: ev => { ev.stopPropagation(); pb.toggleFavorite(e.id); render(); } }, ico('star')),
        moreButton(menuItems, { cls: 'star more' })),
      active ? h('span', { class: 'state chip ok live' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), t('effects.playing')) : null);
    if (!img) libraryThumb(e).then(url => { if (url) { thumb.style.backgroundImage = `url("${url}")`; initials.remove(); } });
    const card = h('div', {
      class: `card lib-card clickable ${active ? 'active' : ''}`, role: 'button', tabindex: '0',
      'aria-label': active ? t('effects.cardPlaying', { name }) : t('effects.cardApply', { name }),
      onclick: apply,
      onkeydown: ev => { if (ev.target === card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); apply(); } },
      oncontextmenu: ev => { ev.preventDefault(); contextMenu(ev.clientX, ev.clientY, menuItems()); }
    },
      thumb,
      h('div', { class: 'lib-body' },
        h('div', { class: 'lib-title' }, name),
        h('div', { class: 'lib-desc' }, fxDescription(e) || t('effects.noDescription'))));
    return card;
  }

  async function uninstall(e) {
    if (!await confirmDialog(t('effects.uninstall'), t('effects.uninstallText', { name: fxName(e) }), t('effects.uninstall'), true)) return;
    const r = await window.api.effects.uninstall(e.id);
    if (!r.ok) return toast(r.error, 'err');
    forgetEffect(e.id);
    setEffects(r.list);
    const fb = pb.fallbackEffect();
    if (get('activeEffect') === e.id && fb) pb.applyEffect(fb.id);
    toast(t('effects.uninstalled', { name: fxName(e) }));
  }

  // "Todos" e "Favoritos" mostram só o que está instalado; o resto fica no Descobrir para baixar
  function renderGrid(body) {
    const label = e => categoryLabel(e.category);
    const cats = [...new Set(library().map(label).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const grid = h('div', { class: 'lib-grid' });
    body.append(h('div', { class: 'toolbar compact' },
      searchBox(st.q, t('effects.search'), v => { st.q = v; draw(); }),
      cats.length > 1 ? h('select', { class: 'input', 'aria-label': t('effects.category'), onchange: e => { st.cat = e.target.value; draw(); } },
        h('option', { value: '' }, t('effects.allCategories')), cats.map(c => h('option', { value: c, selected: st.cat === c }, c))) : null),
      grid);
    function draw() {
      const q = st.q.trim().toLowerCase();
      const match = e => (!st.cat || label(e) === st.cat) && (!q || `${fxName(e)} ${e.name} ${e.publisher} ${fxDescription(e)}`.toLowerCase().includes(q));
      const list = library().filter(e => (tab !== 'fav' || pb.isFavorite(e.id)) && match(e)).sort((a, b) => fxName(a).localeCompare(fxName(b)));
      grid.innerHTML = '';
      for (const e of list) grid.append(effectCard(e));
      // atalho para o Descobrir: quando não há nada, ou no fim de "Todos" enquanto há poucos efeitos instalados
      if (!list.length || (tab === 'all' && !q && !st.cat && library().length < 8)) grid.append(h('div', { class: 'empty' },
        !list.length ? (tab === 'fav' && !q ? t('effects.noFavorites') : t('effects.nothingFound'))
          : t('effects.moreInDiscover'),
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => { tab = 'discover'; set('ui.effectsTab', 'discover', { silent: true }); render(); } }, ico('download'), t('effects.openDiscover')))));
    }
    draw();
  }

  async function newPlaylist() {
    const p = await createPlaylist();
    if (!p) return;
    st.pl = p.id; tab = 'playlists';
    render();
  }

  function renderPlaylists(body) {
    const pls = playlists();
    if (!pls.find(p => p.id === st.pl)) st.pl = pls[0]?.id || null;
    if (!pls.length) {
      body.append(h('div', { class: 'empty' }, h('div', { style: { fontSize: '18px', color: 'var(--text2)', marginBottom: '8px' } }, t('effects.noPlaylistsTitle')),
        t('effects.noPlaylistsText'),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: newPlaylist }, t('effects.createPlaylist')))));
      return;
    }
    const left = h('div', { class: 'panel pl-list col' }, h('h3', {}, t('effects.yourPlaylists')));
    for (const p of pls) left.append(h('div', { class: `node ${p.id === st.pl ? 'sel' : ''}`, onclick: () => { st.pl = p.id; render(); } },
      h('span', {}, p.name), h('span', { class: 'dim' }, `${p.effects.length}`)));
    const right = h('div', { class: 'col' });
    const pl = pls.find(p => p.id === st.pl);
    const timer = app.store.timer;
    const playing = timer.active && timer.playlistId === pl.id;
    const info = [t('effects.effectCount', { n: pl.effects.length }), t('effects.every', { s: timer.intervalSec }),
      timer.shuffle ? t('effects.shuffled') : null, playing ? t('effects.playingNow') : null].filter(Boolean).join(' · ');
    right.append(h('div', { class: 'panel row wrap' },
      h('div', { class: 'grow' }, h('div', { style: { fontSize: '20px', fontWeight: 600 } }, pl.name), h('div', { class: 'dim' }, info)),
      playing ? h('button', { class: 'btn danger', onclick: () => { pb.stopTimer(); render(); } }, ico('stop', 'fill'), t('effects.stop'))
        : h('button', { class: 'btn primary', disabled: !pl.effects.length, onclick: () => { pb.playPlaylist(pl); render(); } }, ico('play', 'fill'), t('effects.play')),
      h('button', { class: 'btn', onclick: () => pickEffects(pl) }, ico('plus'), t('effects.addEffects')),
      moreButton([
        { label: t('effects.renameMenu'), action: async () => { const n = await prompt(t('effects.renamePlaylist'), { value: pl.name, validate: requiredName }); if (n) { pl.name = n; savePlaylists(); render(); } } },
        { label: t('effects.deletePlaylist'), action: async () => {
          if (!await confirmDialog(t('effects.deletePlaylist'), t('effects.deletePlaylistText', { name: pl.name }), t('common.delete'), true)) return;
          deletePlaylist(pl.id);
          if (app.store.timer.playlistId === pl.id) pb.stopTimer();
          render();
        } }], { cls: 'btn icon ghost' })));
    const list = h('div', { class: 'panel' });
    if (!pl.effects.length) list.append(h('div', { class: 'dim' }, t('effects.emptyPlaylist')));
    pl.effects.forEach((id, i) => {
      const e = effectById(id);
      const img = fxImage(e);
      list.append(h('div', { class: 'pl-row' },
        h('span', { class: 'dim', style: { width: '22px' } }, i + 1),
        h('div', { class: 'fx-thumb', style: img ? { backgroundImage: `url("${img}")` } : {} }, img ? '' : (fxName(e) || '?').slice(0, 2)),
        h('div', { class: 'grow' }, h('div', {}, e ? fxName(e) : t('effects.goneFromLibrary')), h('div', { class: 'dim' }, e?.publisher || '')),
        h('button', { class: 'btn sm ghost icon', disabled: !e, title: t('effects.apply'), onclick: () => pb.applyEffect(id) }, ico('play', 'fill')),
        moreButton([
          { label: t('effects.moveUp'), disabled: i === 0, action: () => { [pl.effects[i - 1], pl.effects[i]] = [pl.effects[i], pl.effects[i - 1]]; savePlaylists(); render(); } },
          { label: t('effects.moveDown'), disabled: i === pl.effects.length - 1, action: () => { [pl.effects[i + 1], pl.effects[i]] = [pl.effects[i], pl.effects[i + 1]]; savePlaylists(); render(); } },
          '-',
          { label: t('effects.removeFromPlaylist'), action: () => { pl.effects.splice(i, 1); savePlaylists(); render(); } }])));
    });
    right.append(list);
    body.append(h('div', { class: 'pl-layout' }, left, right));
  }

  async function pickEffects(pl) {
    const chosen = new Set();
    let q = '';
    const list = h('div', { class: 'col', style: { width: '540px', height: '420px', overflow: 'auto' } });
    const draw = () => {
      list.innerHTML = '';
      for (const e of library().filter(e => !q || fxName(e).toLowerCase().includes(q)).sort((a, b) => fxName(a).localeCompare(fxName(b)))) {
        const inPl = pl.effects.includes(e.id);
        list.append(h('label', { class: 'pl-row', style: { cursor: 'pointer', opacity: inPl ? 0.5 : 1 } },
          h('input', { type: 'checkbox', disabled: inPl, checked: chosen.has(e.id) || inPl, onchange: ev => ev.target.checked ? chosen.add(e.id) : chosen.delete(e.id) }),
          h('span', { class: 'grow' }, fxName(e)), h('span', { class: 'dim' }, inPl ? t('effects.alreadyIn') : e.publisher)));
      }
    };
    draw();
    const ok = await modal(t('effects.addEffectsTo', { name: pl.name }), h('div', { class: 'col' },
      h('input', { class: 'input', placeholder: t('effects.search'), oninput: e => { q = e.target.value.toLowerCase(); draw(); } }), list,
      h('div', { class: 'dim' }, t('effects.onlyInstalled'))),
      [{ label: t('common.cancel'), value: () => false }, { label: t('common.add'), primary: true, value: () => true }]);
    if (ok && chosen.size) { pl.effects.push(...chosen); savePlaylists(); render(); toast(t('effects.addedCount', { n: chosen.size })); }
  }


  // o Descobrir se atualiza sozinho ao obter um efeito; redesenhar a página inteira recarregaria as fontes
  const gridTab = () => tab === 'all' || tab === 'fav';
  sub('effects', () => { if (tab !== 'discover') render(); });
  sub('effect', () => { if (gridTab()) render(); });
  sub('thumbs', () => { if (gridTab()) render(); });
  render();
  return () => { subs.forEach(u => u()); discover?.dispose(); };
}
