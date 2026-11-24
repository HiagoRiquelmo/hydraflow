// Utilitários de interface: criação de DOM, toasts, modais, menus e controles de parâmetro.
import { t, paramLabel, paramValue, paramHint } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // acessibilidade: botões só com ícone usam o title como nome acessível
  if (tag === 'button' && attrs?.title && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', attrs.title);
  if (tag === 'button' && !el.hasAttribute('type')) el.type = 'button';
  return el;
}

// Ícones SVG de traço único (mesma linguagem visual da barra lateral) — substituem glifos/emoji.
const ICONS = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3l2.4 5.6L20 9l-4.3 3.9L17 19l-5-3-5 3 1.3-6.1L4 9l5.6-.4z"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  brush: '<path d="M18.5 3.5l2 2-8.5 8.5-2-2z"/><path d="M10 12c-2.8 0-4.5 1.8-4.5 4.5 0 1.3-.8 2-2 2 1.6 1.8 6.6 2.2 8.4-.6.8-1.3.9-2.7.6-3.9"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.7 13.3l8.6-8.6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 18H8.4z"/><path d="M9 9l6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7.5 5v14L19 12z"/>',
  // player (formas cheias: use com a classe "fill")
  pauseSolid: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
  next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
  shuffle: '<path d="M17 3l4 4-4 4V8h-2.6l-7 8H4v-2h2.6l7-8H17zM4 6h3.4l2.1 2.4-1.4 1.6L6.6 8H4zm13 10v-3l4 4-4 4v-3h-3.4l-2.1-2.4 1.4-1.6 1.6 2z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'
};
/** Ícone decorativo (aria-hidden). O texto/aria-label do controle carrega o significado. */
export function icon(name, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', `gl ${cls}`.trim());
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.innerHTML = ICONS[name] || '';
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' },
    icon(type === 'err' ? 'error' : 'check'), h('span', {}, msg));
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 140); }, type === 'err' ? 5000 : 3200);
}

let modalSeq = 0;
const openModals = new Set();
export function closeAllModals() { for (const close of [...openModals]) { openModals.delete(close); close(null); } }
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** Resolve com o valor da ação escolhida (null ao fechar). A promessa devolvida tem .close(valor). Enter num campo aciona a ação principal. */
export function modal(title, body, actions = []) {
  let closeFn;
  const p = new Promise(resolve => {
    const root = document.getElementById('modalRoot');
    const opener = document.activeElement;
    const titleId = `modal-title-${++modalSeq}`;
    const close = v => {
      back.remove(); document.removeEventListener('keydown', onKey); resolve(v);
      if (opener && opener.isConnected) opener.focus?.({ preventScroll: true });
    };
    const onKey = e => {
      if (root.lastElementChild !== back) return;
      if (e.key === 'Escape') { e.preventDefault(); closeFn(null); return; }
      if (e.key === 'Enter' && e.target.matches?.('input:not([type=checkbox])') && box.contains(e.target)) {
        e.preventDefault(); box.querySelector('.actions .btn.primary')?.click(); return;
      }
      if (e.key === 'Tab') {
        const f = [...box.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'modal-head' },
        h('h2', { id: titleId }, title),
        h('button', { class: 'btn icon ghost modal-x', title: t('common.close'), onclick: () => closeFn(null) }, icon('close'))),
      h('div', { class: 'scroll' }, body),
      h('div', { class: 'actions' }, actions.map(a => h('button', {
        class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`,
        onclick: () => { const v = a.value ? a.value() : true; if (v !== undefined) closeFn(v); }
      }, a.label))));
    const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) closeFn(null); } }, box);
    root.append(back);
    document.addEventListener('keydown', onKey);
    (box.querySelector('.scroll input, .scroll select') || box.querySelector('.actions .btn.primary') || box.querySelector('.actions .btn'))?.focus();
    openModals.add(close);
    closeFn = v => { openModals.delete(close); close(v); };
  });
  p.close = v => closeFn?.(v);
  return p;
}

export function prompt(title, { label = '', value = '', placeholder = '', validate } = {}) {
  const input = h('input', { class: 'input', value, placeholder, 'aria-label': label || title, autocomplete: 'off', style: { width: '100%' } });
  const err = h('div', { class: 'dim', role: 'alert', style: { color: 'var(--danger)', minHeight: '16px' } });
  const body = h('div', { class: 'col' }, label ? h('div', { class: 'muted' }, label) : null, input, err);
  return modal(title, body, [
    { label: t('common.cancel'), value: () => null },
    { label: t('common.confirm'), primary: true, value: () => {
      const v = input.value.trim(), e = validate?.(v);
      if (e) { err.textContent = e; input.setAttribute('aria-invalid', 'true'); input.focus(); return undefined; }
      return v;
    } }
  ]);
}

export function confirmDialog(title, text, okLabel = t('common.confirm'), danger = false) {
  return modal(title, h('div', { class: 'muted' }, text), [
    { label: t('common.cancel'), value: () => false },
    { label: okLabel, primary: !danger, danger, value: () => true }
  ]).then(v => !!v);
}

let openMenu = null;
export function contextMenu(x, y, items) {
  openMenu?.remove();
  const opener = document.activeElement;
  const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', off); document.removeEventListener('keydown', onKey, true); };
  const menu = h('div', { class: 'ctxmenu', role: 'menu' }, items.map(it => it === '-' ? h('div', { class: 'sep', role: 'separator' }) :
    h('button', { role: 'menuitem', disabled: it.disabled, onclick: () => { dismiss(); it.action(); } }, it.label)));
  document.body.append(menu);
  setTimeout(() => menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true }), 0);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  openMenu = menu;
  const btns = () => [...menu.querySelectorAll('button:not([disabled])')];
  const onKey = e => {
    if (!menu.isConnected) return;
    const list = btns(), i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); opener?.focus?.({ preventScroll: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  };
  function off(e) { if (!menu.contains(e.target)) dismiss(); }
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

export function searchBox(value, placeholder, onInput) {
  return h('div', { class: 'search' }, icon('search'),
    h('input', { class: 'input', style: { width: '220px' }, placeholder, 'aria-label': placeholder.replace(/…$/, ''), type: 'search', value, oninput: e => onInput(e.target.value) }));
}

/** Botão "⋯" que abre um menu com ações secundárias. `items` pode ser uma função (lida na hora do clique). */
export function moreButton(items, { title = t('common.more'), cls = 'btn sm ghost icon', alignRight = false } = {}) {
  return h('button', { class: cls, title, onclick: ev => {
    ev.stopPropagation();
    const r = ev.currentTarget.getBoundingClientRect();
    const list = (typeof items === 'function' ? items() : items).filter(Boolean);
    contextMenu(alignRight ? r.right - 210 : r.left, r.bottom + 4, list); // 210 = largura mínima do menu (.ctxmenu)
  } }, icon('more'));
}

export function switchEl(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label, onchange: e => onChange(e.target.checked) });
  const el = h('label', { class: 'switch' }, input, h('span', { 'aria-hidden': 'true' }));
  if (!label) requestAnimationFrame(() => {
    const host = el.closest('.dev-card') || el.closest('.row, .param, .card');
    const sel = ['.dev-name', 'label:not(.switch)', '.grow', '.muted', '.dim'].find(s => host?.querySelector(s));
    const name = sel && host.querySelector(sel).textContent.trim();
    if (name && !input.hasAttribute('aria-label')) input.setAttribute('aria-label', name);
  });
  return el;
}

export function slider({ min = 0, max = 100, step = 1, value = 0, hue = false, onInput, onChange, suffix = '' }) {
  const val = h('span', { class: 'val' }, `${value}${suffix}`);
  const input = h('input', {
    type: 'range', min, max, step, value, class: hue ? 'hue' : '',
    oninput: e => { val.textContent = `${e.target.value}${suffix}`; onInput?.(Number(e.target.value)); },
    onchange: e => onChange?.(Number(e.target.value))
  });
  const wrap = h('div', { class: 'ctl' }, input, val);
  wrap.setValue = v => { input.value = v; val.textContent = `${v}${suffix}`; };
  return wrap;
}

function normalizeHex(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('').toLowerCase();
  return '#000000';
}

export function colorInput(value, onChange) {
  const hex = h('input', { class: 'input mono', value: normalizeHex(value), 'aria-label': t('common.colorHex'), spellcheck: 'false', autocomplete: 'off', style: { width: '92px' } });
  const picker = h('input', { type: 'color', value: normalizeHex(value), 'aria-label': t('common.colorPick'), oninput: e => { hex.value = e.target.value; onChange(e.target.value); } });
  hex.addEventListener('change', () => { const v = normalizeHex(hex.value); hex.value = v; picker.value = v; onChange(v); });
  return h('div', { class: 'ctl' }, picker, hex);
}

/** Controle para um parâmetro declarado (efeito ou plugin). scope: efeito que vem com o app (rótulos traduzidos em fx.json). */
export function paramControl(p, value, onChange, scope) {
  const type = String(p.type || '').toLowerCase();
  let ctl;
  if (type === 'number' || type === 'int' || type === 'float') {
    const min = Number(p.min ?? 0), max = Number(p.max ?? 100);
    const step = p.step ?? (type === 'float' || max - min <= 2 ? (max - min) / 100 : 1);
    ctl = slider({ min, max, step, value: Number(value), onInput: onChange });
  } else if (type === 'hue') {
    ctl = slider({ min: p.min ?? 0, max: p.max ?? 360, value: Number(value), hue: true, onInput: onChange });
  } else if (type === 'boolean') {
    ctl = h('div', { class: 'ctl' }, switchEl(value === true || value === 1 || value === '1' || value === 'true', v => onChange(v)));
  } else if (type === 'color') {
    ctl = colorInput(value, onChange);
  } else if (type === 'combobox' || type === 'list') {
    const values = p.values || [];
    ctl = h('div', { class: 'ctl' }, h('select', { class: 'input grow', onchange: e => onChange(e.target.value) },
      values.map(v => h('option', { value: v, selected: String(v) === String(value) }, paramValue(p, v, scope)))));
  } else {
    ctl = h('div', { class: 'ctl' }, h('input', { class: 'input grow', value: value ?? '', onchange: e => onChange(e.target.value) }));
  }
  // liga o rótulo ao controle: clicar no texto foca/aciona e o leitor de tela lê o nome
  const id = `prm-${uid()}`;
  const field = ctl.querySelector('input:not([type=color]), select') || ctl.querySelector('input');
  if (field) field.id = id;
  return h('div', { class: 'param', title: paramHint(p, scope) }, h('label', { for: id }, paramLabel(p, scope)), ctl);
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export const uid = () => crypto.randomUUID();

/** Preenche um console (.console) com linhas de log { t, level, msg } e rola até o fim. */
export function fillConsole(el, lines) {
  el.replaceChildren(...lines.map(l => h('div', { class: l.level }, h('span', { class: 't' }, new Date(l.t).toLocaleTimeString()), l.msg)));
  el.scrollTop = el.scrollHeight;
}

/** Validador de prompt(): nome obrigatório. */
export const requiredName = v => (!v ? t('effects.needName') : null);
