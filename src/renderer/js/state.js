// Estado central da interface + barramento de eventos.
const listeners = new Map();

export const app = {
  store: null,          // espelho do config.json
  effects: [],          // catálogo de efeitos
  devices: new Map(),   // id -> dispositivo publicado pelo motor
  logs: new Map(),      // id -> linhas de console
  components: [],
  engineInfo: { errors: [], hidAvailable: true, lastError: null },
  conflicts: [],
  liveColors: new Map(), // itemKey -> Uint8Array (cores amostradas por LED, ordem das LEDs)
  pulses: new Map()      // itemKey|deviceId -> fim do pulso (ms)
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}

export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(evt, e); } }
}

/** Troca de tela. Quem desenha as telas (app.js) escuta 'navigate'. */
export function navigate(name, opts = {}) { emit('navigate', { name, opts }); }

export function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), app.store);
}

/** Altera o estado e persiste (o caminho usa "." como separador). */
export function set(path, value, { silent = false } = {}) {
  const keys = path.split('.');
  let o = app.store;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
  window.api.store.set(path, value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  if (!silent) emit('store', path);
}

export const defaultTuning = () => ({ r: 100, g: 100, b: 100, min: 0 });

export function deviceSettings(id) {
  const all = app.store.devices || (app.store.devices = {});
  const s = all[id] || (all[id] = {});
  s.enabled ??= true;
  s.brightness ??= 100;
  s.params ??= {};
  s.tuning ??= defaultTuning();
  s.painting ??= {};
  s.channels ??= {};
  return s;
}

export function saveDevice(id) { set(`devices.${id}`, deviceSettings(id)); }

export function deviceName(dev) {
  const s = app.store.devices?.[dev.id];
  return s?.alias || dev.descriptor?.name || dev.plugin?.name || dev.id;
}

/** Efeitos que vêm com o app (a mesma Cor Sólida é o padrão de activeEffect em src/main/store.js). */
export const BUILTIN = { solid: 'builtin:Basicos/Cor Solida.html', screen: 'builtin:Basicos/Ambiente da Tela.html' };

export function effectById(id) { return app.effects.find(e => e.id === id); }

export function setEffects(list) { app.effects = list; emit('effects'); }

/** Imagem do efeito: a que acompanha o arquivo ou a miniatura gerada pelo app. */
export function fxImage(e) { return e ? (e.image || (e.thumb ? `${e.thumb}?v=${e.thumbV || 0}` : null)) : null; }
