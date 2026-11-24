// Efeito ativo, parâmetros, presets, fila (playlist), timer de troca e histórico.
import { app, get, set, emit, effectById, BUILTIN } from './state.js';
import { runner, framePng } from './effectRunner.js';
import { toast } from './ui.js';
import { t } from './i18n.js';
import { playlists } from './playlists.js';

const history = [];
let timerHandle = null;
let timerStart = 0;

export function paramsFor(fx) {
  const saved = app.store.effectParams[fx.id] || {};
  const out = {};
  for (const p of fx.properties) {
    const v = saved[p.property];
    // opção que deixou de existir (ex.: "Valorant (spike)" no Ambiente da Tela) volta ao padrão do efeito
    const gone = p.values && v !== undefined && !p.values.includes(v);
    out[p.property] = v !== undefined && !gone ? v : p.default;
  }
  return out;
}

// ids de efeito contêm "." (ex.: ".html") e o caminho do store usa "." como separador: grava o objeto inteiro
function saveEffectParams() { set('effectParams', app.store.effectParams, { silent: true }); }

// Trocas de efeito em sequência rápida (ligar e desligar o Ambiente da Tela, próximo/anterior): a leitura do arquivo
// é assíncrona, e uma troca antiga que terminasse depois da nova deixava o efeito errado tocando (com a tela de outro).
// Só a última pedida vale. Devolve true se o efeito foi aplicado.
let applySeq = 0;
export async function applyEffect(id, { fromHistory = false, keepTimer = false } = {}) {
  const seq = ++applySeq;
  const fx = effectById(id);
  if (!fx) { toast(t('playback.notFound'), 'err'); return false; }
  const html = await window.api.effects.read(id);
  if (seq !== applySeq) return false; // outra troca foi pedida enquanto este arquivo era lido
  if (html == null) { toast(t('playback.readFailed'), 'err'); return false; }
  const prev = get('activeEffect');
  if (prev && prev !== id && !fromHistory) history.push(prev);
  if (history.length > 50) history.shift();
  set('activeEffect', id, { silent: true });
  runner.load(html, paramsFor(fx), speedFor(fx) / 100, { screen: fx.screen });
  if (!keepTimer && app.store.timer.active) restartTimer();
  emit('effect', fx);
  if (!fx.image && !fx.thumb && !fx.screen) scheduleThumb(fx); // a miniatura do modo tela seria uma foto da área de trabalho
  return true;
}

/** Efeito para quando o escolhido sumiu: a Cor Sólida, ou qualquer um que não capture a tela. */
export function fallbackEffect() {
  return effectById(BUILTIN.solid) || app.effects.find(e => !e.screen) || null;
}

function scheduleThumb(fx) {
  setTimeout(async () => {
    if (get('activeEffect') !== fx.id) return;
    const px = await runner.nextFrame();
    if (!px || get('activeEffect') !== fx.id) return;
    const url = await window.api.effects.saveThumb(fx.id, framePng(px));
    if (url) { fx.thumb = url; fx.thumbV = Date.now(); emit('thumbs'); }
  }, 2500);
}

export function activeEffect() { return effectById(get('activeEffect')); }

export function setEffectParam(fx, name, value) {
  const all = app.store.effectParams;
  all[fx.id] = { ...(all[fx.id] || {}), [name]: value };
  runner.setParam(name, value);
  clearTimeout(setEffectParam.t);
  setEffectParam.t = setTimeout(saveEffectParams, 300);
}

export function speedFor(fx) { return Number((app.store.effectSpeed || {})[fx.id]) || 100; }
export function setEffectSpeed(fx, pct) {
  const all = app.store.effectSpeed || (app.store.effectSpeed = {});
  if (pct === 100) delete all[fx.id]; else all[fx.id] = pct;
  runner.setSpeed(pct / 100);
  clearTimeout(setEffectSpeed.t);
  setEffectSpeed.t = setTimeout(() => set('effectSpeed', all, { silent: true }), 300);
}
export function hasOwnSpeed(fx) {
  return fx.properties.some(p => /^speed$/i.test(p.property) || /^velocidade$/i.test(String(p.label || '').trim()));
}

export function resetEffectParams(fx) {
  delete app.store.effectParams[fx.id];
  saveEffectParams();
  if (app.store.effectSpeed?.[fx.id]) setEffectSpeed(fx, 100);
  for (const p of fx.properties) runner.setParam(p.property, p.default);
  emit('effect', fx);
}

export function presetsFor(fx) { return app.store.presets[fx.id] || {}; }
export function savePreset(fx, name) {
  const all = app.store.presets;
  all[fx.id] = { ...(all[fx.id] || {}), [name]: paramsFor(fx) };
  set('presets', all, { silent: true });
}
export function deletePreset(fx, name) {
  const all = app.store.presets;
  if (all[fx.id]) { delete all[fx.id][name]; if (!Object.keys(all[fx.id]).length) delete all[fx.id]; }
  set('presets', all, { silent: true });
}
export function applyPreset(fx, name) {
  const p = presetsFor(fx)[name];
  if (!p) return;
  app.store.effectParams[fx.id] = { ...p };
  saveEffectParams();
  for (const [k, v] of Object.entries(p)) runner.setParam(k, v);
  emit('effect', fx);
}

export function isFavorite(id) { return (app.store.favorites || []).includes(id); }
export function toggleFavorite(id) {
  const f = new Set(app.store.favorites || []);
  f.has(id) ? f.delete(id) : f.add(id);
  set('favorites', [...f]);
}

function queue() {
  const t = app.store.timer;
  if (t.playlistId) {
    const pl = playlists().find(p => p.id === t.playlistId);
    const ids = (pl?.effects || []).filter(id => effectById(id));
    if (ids.length) return ids;
  }
  // sem playlist: todos menos o Ambiente da Tela (trocar sozinho para a captura da tela surpreenderia)
  return app.effects.filter(e => !e.screen).sort((a, b) => a.name.localeCompare(b.name)).map(e => e.id);
}

export function next() {
  const q = queue();
  if (!q.length) return;
  const cur = get('activeEffect');
  let id;
  if (app.store.timer.shuffle && q.length > 1) {
    do { id = q[Math.floor(Math.random() * q.length)]; } while (id === cur);
  } else {
    const i = q.indexOf(cur);
    id = q[(i + 1) % q.length];
  }
  applyEffect(id, { keepTimer: false });
}

export function previous() {
  const id = history.pop();
  if (id) applyEffect(id, { fromHistory: true });
  else {
    const q = queue();
    const i = q.indexOf(get('activeEffect'));
    if (q.length) applyEffect(q[(i - 1 + q.length) % q.length], { fromHistory: true });
  }
}

export function setShuffle(on) { set('timer', { ...app.store.timer, shuffle: !!on }); emit('timer'); }

export function startTimer(intervalSec, playlistId = app.store.timer.playlistId) {
  set('timer', { ...app.store.timer, intervalSec: Math.max(5, intervalSec | 0), active: true, playlistId: playlistId || null });
  restartTimer();
  emit('timer');
}

export function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
  set('timer', { ...app.store.timer, active: false });
  emit('timer');
}

function restartTimer() {
  clearInterval(timerHandle);
  timerStart = Date.now();
  timerHandle = setInterval(() => {
    if (Date.now() - timerStart >= app.store.timer.intervalSec * 1000) { timerStart = Date.now(); next(); }
    emit('timertick');
  }, 1000);
}

export function timerRemainingMs() {
  if (!app.store.timer.active) return 0;
  return Math.max(0, app.store.timer.intervalSec * 1000 - (Date.now() - timerStart));
}

export function playPlaylist(pl) {
  const ids = pl.effects.filter(id => effectById(id));
  if (!ids.length) { toast(t('playback.emptyPlaylist')); return; }
  set('timer', { ...app.store.timer, playlistId: pl.id }, { silent: true });
  applyEffect(app.store.timer.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0]);
  startTimer(app.store.timer.intervalSec, pl.id);
  toast(t('playback.playingPlaylist', { name: pl.name }));
}

export function setPaused(p) {
  set('canvasPaused', !!p, { silent: true });
  runner.setPaused(!!p);
  emit('paused', !!p);
}

export function resumeOnStartup() {
  if (app.store.timer.active) restartTimer();
}
