// Amostra o quadro do efeito para cada item do layout e envia as cores ao motor.
import { app, on, deviceSettings } from './state.js';
import { runner } from './effectRunner.js';
import { CANVAS_W, CANVAS_H } from './canvas.js';
import { buildItems, itemTransform, ledToCanvas, ledIndexToCanvas, hasPath, layoutBrightness, globalBrightness } from './layoutModel.js';

let items = [];
let itemsDirty = true;
export function invalidateItems() { itemsDirty = true; }
export function currentItems() { if (itemsDirty) { items = buildItems(); itemsDirty = false; } return items; }

function hexRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

export const PULSE_MS = 3000;

/** Faz um item do layout (ou um dispositivo inteiro, pela id) piscar em branco. */
export function pulse(key, ms = PULSE_MS) { app.pulses.set(key, performance.now() + ms); }

function pulseValue(key, deviceId, now) {
  const end = Math.max(app.pulses.get(key) || 0, app.pulses.get(deviceId) || 0);
  if (end < now) return -1;
  return Math.round((Math.sin(now / 160) * 0.5 + 0.5) * 255);
}

function pixelIndex(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  return ix < 0 || iy < 0 || ix >= CANVAS_W || iy >= CANVAS_H ? -1 : (iy * CANVAS_W + ix) * 4;
}

function samplingFor(item, t) {
  const path = hasPath(item, t) ? t.path : null; // forma livre (cobrinha): cada LED na célula que a pessoa escolheu
  const sig = `${t.x},${t.y},${t.scale},${t.rotation},${t.invertX},${t.invertY},${path ? path.join(';') : ''}`;
  if (item._sampling?.sig === sig) return item._sampling;
  let pix, led;
  if (item.kind === 'component') {
    pix = new Int32Array(item.leds.length);
    item.leds.forEach((_, i) => { const [x, y] = ledIndexToCanvas(item, t, i); pix[i] = pixelIndex(x, y); });
  } else {
    const n = item.w * item.h;
    pix = new Int32Array(n);
    led = new Int32Array(n).fill(-1);
    item.leds.forEach(([lx, ly], i) => { if (lx >= 0 && ly >= 0 && lx < item.w && ly < item.h) led[ly * item.w + lx] = i; });
    for (let y = 0; y < item.h; y++) for (let x = 0; x < item.w; x++) {
      const li = led[y * item.w + x];
      const [cx, cy] = path && li >= 0 ? ledIndexToCanvas(item, t, li) : ledToCanvas(item, t, x, y);
      pix[y * item.w + x] = pixelIndex(cx, cy);
    }
  }
  return (item._sampling = { sig, pix, led });
}

const rgbCache = new Map();
function paintRgb(hex) { let c = rgbCache.get(hex); if (!c) { c = hexRgb(hex); rgbCache.set(hex, c); } return c; }

// Tabela única de amostragem (todos os itens em sequência) que o efeito usa para devolver só os pixels sob os LEDs.
// item._base: posição do primeiro ponto do item nas amostras.
let tableSig = '', tableList = null;
function syncGatherTable(list) {
  const parts = list.map(item => samplingFor(item, itemTransform(item)));
  const sig = list.map((it, i) => `${it.key}|${parts[i].sig}`).join(';');
  if (sig === tableSig && list === tableList) return;
  let base = 0;
  list.forEach((item, i) => { item._base = base; base += parts[i].pix.length; });
  tableList = list;
  if (sig === tableSig) return; // lista reconstruída com as mesmas posições: a tabela do efeito continua valendo
  tableSig = sig;
  const idx = new Int32Array(base);
  list.forEach((item, i) => idx.set(parts[i].pix, item._base));
  runner.setGather(idx);
}

/** samples: amostras da tabela atual (ou null: ainda nenhuma, envia preto). */
function tick(samples) {
  const now = performance.now();
  const list = currentItems();
  const payload = {};
  const gk = globalBrightness() / 100 * layoutBrightness() / 100;
  for (const item of list) {
    const s = deviceSettings(item.deviceId);
    const t = itemTransform(item);
    const k = gk * (Number(s.brightness ?? 100) / 100);
    const kr = k * (s.tuning?.r ?? 100) / 100, kg = k * (s.tuning?.g ?? 100) / 100, kb = k * (s.tuning?.b ?? 100) / 100;
    const min = (s.tuning?.min ?? 0) * 2.55;
    const paint = s.painting?.[item.key];
    const pulse = pulseValue(item.key, item.deviceId, now);
    const dp = payload[item.deviceId] || (payload[item.deviceId] = { device: null, subs: {}, channels: {} });
    const { pix, led } = samplingFor(item, t);
    const base = item._base;
    const live = new Uint8Array(item.leds.length * 3);

    // j: ponto de amostragem do item (pix[j] < 0 = fora do canvas)
    const write = (out, o, li, j) => {
      if (pulse >= 0) { out[o] = out[o + 1] = out[o + 2] = pulse; return; }
      let r, g, b;
      const pc = li >= 0 && paint ? paint[li] : null;
      if (pc) { const c = paintRgb(pc); r = c[0]; g = c[1]; b = c[2]; }
      else if (samples && pix[j] >= 0) { const si = (base + j) * 3; r = samples[si]; g = samples[si + 1]; b = samples[si + 2]; }
      else { out[o] = out[o + 1] = out[o + 2] = 0; return; }
      r *= kr; g *= kg; b *= kb;
      if (min > 0 && (r > g ? (r > b ? r : b) : (g > b ? g : b)) < min) r = g = b = 0;
      out[o] = r > 255 ? 255 : r | 0; out[o + 1] = g > 255 ? 255 : g | 0; out[o + 2] = b > 255 ? 255 : b | 0;
    };

    if (item.kind === 'component') {
      const n = item.leds.length;
      const out = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        write(live, i * 3, i, i);
        const p = (item.mapping?.[i] ?? i) * 3;
        out[p] = live[i * 3]; out[p + 1] = live[i * 3 + 1]; out[p + 2] = live[i * 3 + 2];
      }
      (dp._chains ||= {})[item.channel] ||= [];
      dp._chains[item.channel].push(out);
    } else {
      // grade completa: device.color(x, y) pode consultar qualquer célula
      const n = item.w * item.h;
      const grid = new Uint8Array(n * 3);
      for (let c = 0; c < n; c++) {
        const li = led[c];
        write(grid, c * 3, li, c);
        if (li >= 0) { live[li * 3] = grid[c * 3]; live[li * 3 + 1] = grid[c * 3 + 1]; live[li * 3 + 2] = grid[c * 3 + 2]; }
      }
      const frame = { w: item.w, h: item.h, data: grid };
      if (item.kind === 'device') dp.device = frame; else dp.subs[item.subName] = frame;
    }
    app.liveColors.set(item.key, live);
  }

  for (const dp of Object.values(payload)) {
    if (!dp._chains) continue;
    for (const [ch, parts] of Object.entries(dp._chains)) {
      const total = parts.reduce((a, p) => a + p.length, 0);
      const buf = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { buf.set(p, o); o += p.length; }
      dp.channels[ch] = buf;
    }
    delete dp._chains;
  }
  for (const dev of app.devices.values()) {
    if (!dev.descriptor) continue;
    const dp = payload[dev.id] || (payload[dev.id] = { device: null, subs: {}, channels: {} });
    for (const ch of dev.descriptor.channels) if (!dp.channels[ch.name]) dp.channels[ch.name] = new Uint8Array(0);
  }
  // o motor guarda o último quadro de cada dispositivo: só manda quando muda (e de vez em quando, caso o motor reinicie)
  if (now - lastSentAt < 1000 && samePayload(payload, lastPayload)) return;
  lastPayload = payload; lastSentAt = now;
  window.api.engine.frame(payload);
}

let lastPayload = null, lastSentAt = 0;
const sameBytes = (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
const sameFrame = (a, b) => a === b || (!!a && !!b && a.w === b.w && a.h === b.h && sameBytes(a.data, b.data));
function samePayload(a, b) {
  if (!b) return false;
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  for (const id of ids) {
    const x = a[id], y = b[id];
    if (!y || !sameFrame(x.device, y.device)) return false;
    for (const group of ['subs', 'channels']) {
      const keys = Object.keys(x[group]);
      if (keys.length !== Object.keys(y[group]).length) return false;
      for (const k of keys) if (group === 'subs' ? !sameFrame(x.subs[k], y.subs[k]) : !sameBytes(x.channels[k], y.channels[k])) return false;
    }
  }
  return true;
}

/** Amostras que valem para a tabela atual; as de uma tabela antiga (layout acabou de mudar) são descartadas. */
const current = s => (s && s.v === runner.gather?.v ? s.data : null);

export function startSampler() {
  let last = 0;
  on('samples', s => {
    const now = performance.now();
    // efeitos: até ~33 por segundo bastam e poupam o motor; quadros de tela passam todos — descartar um aqui
    // atrasava a mudança na tela até o quadro seguinte
    if (now - last < (s.realtime ? 4 : 30)) return;
    syncGatherTable(currentItems());
    const data = current(s);
    if (!data) return;
    last = now;
    tick(data);
  });
  // efeito pausado ou sem efeito: o host não manda nada novo, mas os dispositivos (e mudanças de layout) seguem alimentados
  setInterval(() => {
    syncGatherTable(currentItems());
    if (performance.now() - runner.lastSampleAt < 200) return;
    const data = current(runner.samples);
    if (data || !runner.samples) tick(data); // tabela acabou de mudar: mantém as últimas cores até chegar a amostra nova
  }, 250); // 4×/s basta para efeito parado e mudanças de layout (o envio ao motor já é só quando muda)
  on('devices', invalidateItems);
  on('store', path => { if (/^devices\.|^layouts/.test(path)) invalidateItems(); });
  on('layout', invalidateItems);
}
