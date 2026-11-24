// Partes da biblioteca de mídia usadas por mais de uma tela (Papel de Parede e Watercooler):
// miniaturas paradas, tamanho em texto, importação e exclusão com aviso de uso.
import { h, toast, confirmDialog, modal, icon as ico } from './ui.js';
import { t, fmtNumber } from './i18n.js';

/** "230 MB", "1,2 GB" no formato do idioma. */
export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n || 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(v, { maximumFractionDigits: v < 10 && i ? 1 : 0 })} ${units[i]}`;
}

// Miniatura PNG parada, gerada uma vez pelo processo principal (miniaturas do próprio Windows: vídeo, GIF e imagem)
// e guardada pela biblioteca: a grade não fica tocando GIFs e vídeos (isso gastava CPU com a aba aberta).
let thumbQueue = Promise.resolve();
/** URL da miniatura (gera e guarda se ainda não existe). Uma por vez. */
function thumbFor(item) {
  if (item.thumb) return Promise.resolve(item.thumb);
  const job = thumbQueue.then(() => window.api.library.thumb(item.id));
  thumbQueue = job.catch(() => null);
  return job.then(url => { if (url) item.thumb = url; return url; });
}

/** Resumo de uma importação, em um aviso. */
export function importToast(r) {
  const parts = [];
  if (r.added.length) parts.push(t('library.added', { n: r.added.length }));
  if (r.duplicates.length) parts.push(t('library.duplicates', { n: r.duplicates.length }));
  if (r.skipped.length) parts.push(t('library.skipped', { n: r.skipped.length }));
  if (parts.length) toast(parts.join(' · '), r.skipped.length && !r.added.length ? 'err' : '');
}

/** Exclui um item, avisando antes; se estiver em uso, explica o que vai desligar. Devolve a resposta da biblioteca ou null. */
export async function removeItem(item) {
  if (!await confirmDialog(t('library.removeTitle'), t('library.removeText', { name: item.name }), t('common.delete'), true)) return null;
  let r = await window.api.library.remove(item.id, false);
  if (!r.ok && r.inUse) {
    const where = r.inUse.map(u => t(`library.usedBy.${u}`)).join(t('library.and'));
    if (!await confirmDialog(t('library.inUseTitle'), t('library.inUseText', { where }), t('library.removeAnyway'), true)) return null;
    r = await window.api.library.remove(item.id, true);
  }
  if (!r.ok) { toast(r.error || t('library.removeFailed'), 'err'); return null; }
  toast(t('library.removed'));
  return r;
}

/** Aceita arquivos arrastados do Explorer para `el`; onImported recebe a resposta da biblioteca. */
export function dropZone(el, onImported) {
  let depth = 0;
  el.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; el.classList.add('dropping'); } });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('dropping'); } });
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  el.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; el.classList.remove('dropping');
    const paths = [...(e.dataTransfer?.files || [])].map(f => window.api.library.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    toast(t('library.importing'));
    const r = await window.api.library.importPaths(paths);
    importToast(r);
    onImported(r);
  });
}

/** Cartão de um item: miniatura, nome, tipo/tamanho, selos de uso e o menu de ações. */
export function mediaCard(item, { usage, onClick, menu, active }) {
  const thumb = h('div', { class: 'lib-thumb wp-thumb' });
  const setImg = url => { if (url) Object.assign(thumb.style, { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }); };
  setImg(item.thumb);
  if (!item.thumb) thumbFor(item).then(setImg);
  const badges = [];
  if (usage?.wallpaper === item.id && usage.wallpaperOn) badges.push(h('span', { class: 'chip ok live' }, t('library.badgeWallpaper')));
  if (usage?.cooler === item.id && usage.coolerOn) badges.push(h('span', { class: 'chip ok live' }, t('library.badgeCooler')));
  if (badges.length) thumb.append(h('div', { class: 'state', style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, badges));
  if (item.kind === 'video') thumb.append(h('span', { class: 'lib-kind', 'aria-hidden': 'true' }, ico('play', 'fill')));
  if (menu) thumb.append(h('div', { class: 'thumb-tools' }, menu));
  const card = h('div', { class: `card lib-card clickable ${active ? 'active' : ''}`, role: 'button', tabindex: '0', 'aria-label': item.name,
    onclick: onClick, onkeydown: e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick?.(); } } },
    thumb,
    h('div', { class: 'lib-body' }, h('div', { class: 'lib-title' }, item.name),
      h('div', { class: 'lib-desc' }, `${t(`library.kind.${item.kind}`)} · ${fmtBytes(item.size)}`)));
  return card;
}

/** Janela para escolher um item (o Watercooler usa para escolher a imagem). onlyImages: sem vídeos. */
export async function pickFromLibrary({ title, onlyImages = true, current = null } = {}) {
  let lib = await window.api.library.list();
  let chosen = null;
  const grid = h('div', { class: 'lib-grid', style: { width: 'min(860px, 80vw)', maxHeight: '60vh', overflow: 'auto' } });
  const draw = () => {
    const items = lib.items.filter(i => !onlyImages || i.kind !== 'video');
    grid.replaceChildren(...(items.length ? items.map(i => mediaCard(i, { usage: lib.usage, active: i.id === current, onClick: () => { chosen = i.id; dlg.close(true); } }))
      : [h('div', { class: 'empty' }, t('library.pickEmpty'))]));
  };
  const add = h('button', { class: 'btn', onclick: async () => {
    const r = await window.api.library.import(onlyImages);
    importToast(r);
    lib = r; draw();
    if (r.added.length === 1) { chosen = r.added[0]; dlg.close(true); } // importou um só: já escolhe
  } }, ico('plus'), t('library.addFromPc'));
  const body = h('div', { class: 'col' }, h('div', { class: 'row' }, h('span', { class: 'grow dim' }, t('library.pickHint')), add), grid);
  dropZone(body, r => { lib = r; draw(); });
  const dlg = modal(title || t('library.pickTitle'), body, [{ label: t('common.cancel'), value: () => null }]);
  draw();
  await dlg;
  return chosen;
}
