// Aba Papel de Parede: ajustes do papel de parede animado + a biblioteca de mídia do Hydraflow (imagens, GIFs e
// vídeos copiados para dentro do app — ver src/main/library.js). Quem desenha o fundo é um processo à parte
// (src/wallpaper); aqui só se escolhe o arquivo e os ajustes. A mesma biblioteca alimenta a tela do watercooler.
import { app } from '../state.js';
import { setCooler } from '../coolerStream.js';
import { h, switchEl, toast, prompt, moreButton, searchBox, requiredName, icon as ico } from '../ui.js';
import { t } from '../i18n.js';
import { fmtBytes, importToast, removeItem, dropZone, mediaCard } from '../library.js';

const FILTERS = ['all', 'video', 'animated', 'image'];

export function renderWallpaper(root) {
  let w = null, lib = null, disposed = false, filter = 'all', q = '';
  const settings = h('div');
  const libBody = h('div');
  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head compact' }, h('h1', {}, t('wallpaper.title')), h('div', { class: 'grow' }),
      h('button', { class: 'btn sm primary', onclick: add }, ico('plus'), t('wallpaper.addFiles'))),
    h('div', { class: 'page-sub', style: { padding: '0 28px 4px' } }, t('wallpaper.subtitle')),
    h('div', { class: 'page-body' }, settings, libBody));
  root.append(page);
  dropZone(page, r => { lib = r; renderLibrary(); });

  async function add() {
    const r = await window.api.library.import(false);
    importToast(r);
    lib = r; renderLibrary();
  }
  async function patch(p) { w = await window.api.wallpaper.set(p); renderSettings(); }
  async function refreshLibrary() { lib = await window.api.library.list(); renderLibrary(); }

  function renderSettings() {
    if (disposed || !w) return;
    settings.replaceChildren(h('div', { class: 'panel wp-bar' },
      h('div', { class: 'param' }, h('label', {}, t('wallpaper.enabled')),
        switchEl(!!(w.enabled && w.file), v => {
          if (v && !w.file) { toast(t('wallpaper.pickFirst')); renderSettings(); return; }
          patch({ enabled: v }).then(refreshLibrary);
        }, t('wallpaper.enabledLabel'))),
      h('div', { class: 'param' }, h('label', {}, t('wallpaper.fit')),
        h('select', { class: 'input', 'aria-label': t('wallpaper.fit'), onchange: e => patch({ fit: e.target.value }) },
          [['cover', t('wallpaper.fitCover')], ['fill', t('wallpaper.fitFill')], ['contain', t('wallpaper.fitContain')]]
            .map(([v, l]) => h('option', { value: v, selected: (w.fit || 'cover') === v }, l)))),
      h('div', { class: 'param' }, h('label', {}, t('wallpaper.pauseFullscreen')),
        switchEl(!!w.pauseFullscreen, v => patch({ pauseFullscreen: v }), t('wallpaper.pauseFullscreen'))),
      w.pauseFullscreen ? h('div', { class: 'param', title: t('wallpaper.pauseMaximizedHint') },
        h('label', {}, t('wallpaper.pauseMaximized')),
        switchEl(!!w.pauseMaximized, v => patch({ pauseMaximized: v }), t('wallpaper.pauseMaximized'))) : null,
      w.error ? h('div', { class: 'banner err', role: 'alert' }, ico('error'), h('span', { class: 'grow' }, w.error)) : null));
  }

  function renderLibrary() {
    if (disposed || !lib) return;
    const counts = Object.fromEntries(FILTERS.map(f => [f, f === 'all' ? lib.items.length : lib.items.filter(i => i.kind === f).length]));
    const head = h('div', { class: 'toolbar compact', style: { alignItems: 'center' } },
      h('h3', { style: { margin: 0 } }, t('library.title')),
      h('div', { class: 'tabs' }, FILTERS.map(f => h('button', { class: `tab ${filter === f ? 'active' : ''}`, 'aria-pressed': String(filter === f),
        onclick: () => { filter = f; renderLibrary(); } }, t(`library.filter.${f}`), h('span', { class: 'n' }, counts[f])))),
      searchBox(q, t('effects.search'), v => { q = v; drawGrid(); }),
      h('span', { class: 'grow' }),
      h('span', { class: 'dim', title: t('library.storageHint') }, t('library.storage', { n: lib.items.length, size: fmtBytes(lib.totalBytes) })),
      moreButton([{ label: t('library.openFolder'), action: () => window.api.library.openFolder() }], { cls: 'btn icon ghost', alignRight: true }));
    const grid = h('div', { class: 'lib-grid' });
    libBody.replaceChildren(head, grid);
    function drawGrid() {
      const ql = q.trim().toLowerCase();
      const items = lib.items.filter(i => (filter === 'all' || i.kind === filter) && (!ql || i.name.toLowerCase().includes(ql)));
      if (!lib.items.length) {
        grid.replaceChildren(h('div', { class: 'empty' },
          h('div', { style: { fontSize: '18px', color: 'var(--text2)', marginBottom: '8px' } }, t('wallpaper.emptyTitle')),
          t('wallpaper.emptyText'),
          h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: add }, ico('plus'), t('common.add')))));
        return;
      }
      if (!items.length) { grid.replaceChildren(h('div', { class: 'empty' }, t('effects.nothingFound'))); return; }
      grid.replaceChildren(...items.map(item => {
        const onDesktop = lib.usage.wallpaper === item.id && lib.usage.wallpaperOn;
        const use = async () => { if (onDesktop) return; await patch({ item: item.id, enabled: true }); toast(t('wallpaper.applied')); refreshLibrary(); };
        return mediaCard(item, {
          usage: lib.usage, active: onDesktop, onClick: use,
          menu: moreButton(() => [
            { label: t('library.useWallpaper'), disabled: onDesktop, action: use },
            item.kind !== 'video' ? { label: t('library.useCooler'), action: async () => { await setCooler({ item: item.id }); toast(t('library.coolerSet')); refreshLibrary(); } } : null,
            { label: t('effects.renameMenu'), action: async () => { const n = await prompt(t('library.renameTitle'), { value: item.name, validate: requiredName }); if (n) { lib = await window.api.library.rename(item.id, n); renderLibrary(); } } },
            '-',
            { label: t('library.removeMenu'), action: async () => { const r = await removeItem(item); if (r) { lib = r; w = await window.api.wallpaper.get(); renderSettings(); renderLibrary(); } } }
          ], { cls: 'star more' })
        });
      }));
    }
    drawGrid();
  }

  const off = window.api.wallpaper.onStatus(s => { if (w) { w = { ...w, ...s }; renderSettings(); } });
  window.api.wallpaper.get().then(x => { w = x; renderSettings(); });
  refreshLibrary();
  return () => { disposed = true; off(); };
}
