'use strict';
// Executa um plugin de dispositivo num contexto vm isolado e expõe a API "device".
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { transformModule } = require('./transform');
const { makeShims, shimNameFor, noopProxy } = require('./shims');
const { sleepSync } = require('../common/sleepSync');

/** E/S que aceita tudo e não lê nada: dispositivos virtuais, leitura de metadados e testes. */
const nullIo = () => ({ failures: 0, write: b => b.length, read: () => null, sendFeature: b => b.length, getFeature: () => null, close() {} });

function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex.slice(0, 3);
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

const ORDERS = { RGB: [0, 1, 2], RBG: [0, 2, 1], BGR: [2, 1, 0], BRG: [2, 0, 1], GBR: [1, 2, 0], GRB: [1, 0, 2] };

function formatColors(rgbFlat, count, format = 'Inline', order = 'RGB') {
  const o = ORDERS[order] || ORDERS.RGB;
  if (String(format).toLowerCase() === 'separate') {
    const a = [[], [], []];
    for (let i = 0; i < count; i++) { a[0].push(rgbFlat[i * 3 + o[0]] || 0); a[1].push(rgbFlat[i * 3 + o[1]] || 0); a[2].push(rgbFlat[i * 3 + o[2]] || 0); }
    return a;
  }
  const out = new Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = rgbFlat[i * 3 + o[0]] || 0;
    out[i * 3 + 1] = rgbFlat[i * 3 + o[1]] || 0;
    out[i * 3 + 2] = rgbFlat[i * 3 + o[2]] || 0;
  }
  return out;
}

function toBool(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }

function convertParam(p, value) {
  const v = value === undefined ? p.default : value;
  switch (String(p.type).toLowerCase()) {
    case 'number': case 'hue': case 'int': case 'float': return Number(v);
    case 'boolean': return toBool(v);
    default: return v == null ? '' : String(v);
  }
}

function loadSource(file, cache) {
  if (!cache.has(file)) cache.set(file, transformModule(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}

/**
 * Cria uma instância de plugin.
 * opts: { file, io (HID ou virtual), endpoint, endpoints, systemInfo, log(linha), params }
 */
class PluginInstance {
  constructor(opts) {
    this.opts = opts;
    this.file = opts.file;
    this.io = opts.io;
    this.logs = [];
    this.state = {
      name: null, size: [1, 1], ledNames: [], ledPositions: [], image: '',
      subdevices: new Map(), channels: new Map(), ledLimit: 0, frameRate: 30, properties: []
    };
    this.frame = { device: null, subs: {}, channels: {} };
    this.pulse = { channels: new Set(), started: 0 };
    this.lastReadSize = 0;
    this.dirty = true;
    this._build();
  }

  log(level, msg) {
    const line = { t: Date.now(), level, msg: typeof msg === 'string' ? msg : (() => { try { return JSON.stringify(msg); } catch { return String(msg); } })() };
    this.logs.push(line);
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
    this.opts.log?.(line);
  }

  _deviceApi() {
    const self = this;
    const st = this.state;
    const touch = () => { self.dirty = true; };
    const sub = name => st.subdevices.get(name);
    const sample = (buf, w, x, y) => {
      if (!buf) return [0, 0, 0];
      const i = (Math.floor(y) * w + Math.floor(x)) * 3;
      if (x < 0 || y < 0 || x >= w || i < 0 || i + 2 >= buf.length) return [0, 0, 0];
      return [buf[i] || 0, buf[i + 1] || 0, buf[i + 2] || 0];
    };
    const pad = (data, length) => {
      const arr = Array.from(data || [], v => Number(v) & 0xff);
      if (length && arr.length < length) while (arr.length < length) arr.push(0);
      if (length && arr.length > length) arr.length = length;
      return arr;
    };
    const pulseColor = () => {
      const t = (Date.now() - self.pulse.started) / 1000;
      const k = Math.round((Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * 255);
      return '#' + [k, k, k].map(v => v.toString(16).padStart(2, '0')).join('');
    };

    const api = {
      setName(n) { st.name = String(n); touch(); },
      getName() { return st.name; },
      setSize(w, h) { if (Array.isArray(w)) [w, h] = w; st.size = [Math.max(1, w | 0), Math.max(1, h | 0)]; touch(); },
      setControllableLeds(names, positions) { st.ledNames = [...(names || [])]; st.ledPositions = (positions || []).map(p => [p[0], p[1]]); touch(); },
      getLedCount() { return st.ledPositions.length; },
      setImageFromUrl(url) { st.image = String(url || ''); touch(); },
      setImageFromBase64() {},
      setFrameRateTarget(fps) { st.frameRate = Math.max(1, Math.min(144, Number(fps) || 30)); },
      SetLedLimit(n) { st.ledLimit = Number(n) || 0; },

      createSubdevice(name) { if (!st.subdevices.has(name)) st.subdevices.set(name, { name, displayName: name, size: [1, 1], ledNames: [], ledPositions: [], image: '' }); touch(); },
      removeSubdevice(name) { st.subdevices.delete(name); touch(); },
      setSubdeviceName(name, display) { const s = sub(name); if (s) { s.displayName = String(display); touch(); } },
      setSubdeviceSize(name, w, h) { const s = sub(name); if (s) { s.size = [Math.max(1, w | 0), Math.max(1, h | 0)]; touch(); } },
      setSubdeviceLeds(name, names, positions) { const s = sub(name); if (s) { s.ledNames = [...(names || [])]; s.ledPositions = (positions || []).map(p => [p[0], p[1]]); touch(); } },
      setSubdeviceImage(name, url) { const s = sub(name); if (s) { s.image = String(url || ''); touch(); } },
      setSubdeviceImageUrl(name, url) { const s = sub(name); if (s) { s.image = String(url || ''); touch(); } },
      getSubdevices() { return [...st.subdevices.keys()]; },

      color(x, y) {
        const f = self.frame.device;
        return f ? sample(f.data, f.w, x, y) : [0, 0, 0];
      },
      subdeviceColor(name, x, y) {
        const f = self.frame.subs[name];
        return f ? sample(f.data, f.w, x, y) : [0, 0, 0];
      },
      createColorArray(color, count, format = 'Inline', order = 'RGB') {
        const c = hexToRgb(color);
        const flat = new Array(count * 3);
        for (let i = 0; i < count; i++) { flat[i * 3] = c[0]; flat[i * 3 + 1] = c[1]; flat[i * 3 + 2] = c[2]; }
        return formatColors(flat, count, format, order);
      },

      addChannel(name, ledLimit = 204) { st.channels.set(name, { name, ledLimit: Number(ledLimit) || 0 }); touch(); },
      removeChannel(name) { st.channels.delete(name); touch(); },
      channel(name) {
        const ch = st.channels.get(name);
        const colors = () => self.frame.channels[name] || new Uint8Array(0);
        const count = () => Math.min(colors().length / 3, ch?.ledLimit || Infinity);
        return {
          LedCount: count,
          ledCount: count,
          LedLimit: () => ch?.ledLimit || 0,
          getColors(format = 'Inline', order = 'RGB') { return formatColors(colors(), count(), format, order); },
          shouldPulseColors() { return self.pulse.channels.has(name); },
          getComponentNames() { return []; }
        };
      },
      getChannelNames() { return [...st.channels.keys()]; },
      getChannelPulseColor() { return pulseColor(); },
      channelPulseColor() { return pulseColor(); },

      write(data, length) { const b = pad(data, length); return self.io.write(b); },
      read(data, length, timeout = 1000) {
        const r = self.io.read(length, timeout);
        if (!r || !r.length) { self.lastReadSize = 0; return new Array(length || 0).fill(0); }
        self.lastReadSize = r.length;
        const arr = Array.from(r);
        if (length && arr.length < length) while (arr.length < length) arr.push(0);
        return arr;
      },
      input_read(data, length, timeout) { return api.read(data, length, timeout); },
      send_report(data, length) { return self.io.sendFeature(pad(data, length)); },
      get_report(data, length) {
        const r = self.io.getFeature((data && data[0]) || 0, length);
        self.lastReadSize = r ? r.length : 0;
        const arr = r ? Array.from(r) : [];
        while (length && arr.length < length) arr.push(0);
        return arr;
      },
      getLastReadSize() { return self.lastReadSize; },
      flush() { for (let i = 0; i < 64; i++) { const r = self.io.read(0, 0); if (!r || !r.length) break; } self.lastReadSize = 0; },
      clearReadBuffer() { api.flush(); },
      pause(ms) { sleepSync(Number(ms) || 0); },
      set_endpoint(iface, usage, usagePage, collection) {
        const ok = self.io.setEndpoint?.({ interface: iface, usage, usage_page: usagePage, collection });
        if (!ok) self.log('warning', `set_endpoint(${iface}, ${usage}, ${usagePage}) não encontrado`);
        return ok;
      },
      getHidEndpoints() { return self.opts.endpoints || []; },
      getHidInfo() { return self.opts.endpoint || {}; },
      productId() { return self.opts.endpoint?.product_id ?? 0; },
      vendorId() { return self.opts.endpoint?.vendor_id ?? 0; },
      bulk_transfer() { self.log('warning', 'bulk_transfer não suportado'); return 0; },
      control_transfer() { self.log('warning', 'control_transfer não suportado'); return 0; },

      addProperty(p) {
        if (!p || !p.property) return;
        st.properties = st.properties.filter(x => x.property !== p.property).concat([p]);
        if (!(p.property in self.context) || self.context[p.property] === undefined) self.context[p.property] = convertParam(p, self.opts.params?.[p.property]);
        touch();
      },
      removeProperty(name) { st.properties = st.properties.filter(x => x.property !== name); touch(); },
      getProperty(name) { return { value: self.context[name] }; },

      fanControlDisabled() { return true; },
      createFanControl() {}, removeFanControl() {}, setRPM() {}, getNormalizedFanlevel() { return 0; }, getFanlevel() { return 0; },
      createTemperatureSensor() {}, SetTemperature() {}, removeTemperatureSensor() {},
      lcdControlAllowed() { return false; },
      addFeature(name) {
        // recursos opcionais (bateria, mouse, ...) viram objetos neutros no escopo global do plugin
        if (name && self.context && self.context[name] === undefined) self.context[name] = noopProxy(String(name), m => self.log('warning', m));
        return self.context?.[name];
      },
      notify(title, desc) { self.log('info', `[notificação] ${title}${desc ? ': ' + desc : ''}`); },
      log(msg, opts) { self.log(typeof opts === 'object' && opts?.level ? opts.level : 'info', msg); },
      repollName() {}, setDeviceType() {}, setSubdeviceType() {}
    };

    const warned = new Set();
    return new Proxy(api, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'symbol') return undefined;
        if (!warned.has(prop)) { warned.add(prop); self.log('warning', `API device.${prop} não suportada — ignorada`); }
        return () => undefined;
      }
    });
  }

  _build() {
    const cache = new Map();
    const shims = makeShims({ systemInfo: this.opts.systemInfo || {}, log: m => this.log('warning', m) });
    const device = this._deviceApi();
    const consoleShim = {
      log: (...a) => this.log('info', a.map(String).join(' ')),
      info: (...a) => this.log('info', a.map(String).join(' ')),
      warn: (...a) => this.log('warning', a.map(String).join(' ')),
      error: (...a) => this.log('error', a.map(String).join(' ')),
      debug: () => {}, trace: () => {}
    };
    const sandbox = {
      device, console: consoleShim, __exports: {},
      setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
      Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView
    };
    this.context = vm.createContext(sandbox, { name: path.basename(this.file) });
    const ctx = this.context;
    const self = this;
    ctx.__require = function (spec) {
      const shim = shimNameFor(spec);
      if (shim) return shims[shim] || { default: undefined };
      if (spec.startsWith('.')) {
        let full = path.resolve(path.dirname(self.file), spec);
        if (!fs.existsSync(full) && fs.existsSync(full + '.js')) full += '.js';
        const key = '__mod:' + full;
        if (!ctx[key]) {
          const { code } = loadSource(full, cache);
          const wrapped = `(function(__exports){\n${code}\nreturn __exports;})({})`;
          ctx[key] = vm.runInContext(wrapped, ctx, { filename: full, timeout: 5000 });
        }
        return ctx[key];
      }
      throw new Error(`Módulo não suportado: ${spec}`);
    };
    const { code } = loadSource(this.file, cache);
    vm.runInContext(code, ctx, { filename: this.file, timeout: 8000 });
    this.exports = ctx.__exports;
  }

  has(fn) { return typeof this.exports[fn] === 'function' || typeof this.context[fn] === 'function'; }

  call(fn, ...args) {
    const f = typeof this.exports[fn] === 'function' ? this.exports[fn] : this.context[fn];
    if (typeof f !== 'function') return undefined;
    return f(...args);
  }

  value(fn, fallback) {
    try { const v = this.call(fn); return v === undefined ? fallback : v; } catch { return fallback; }
  }

  parameters() {
    let base = [];
    try { base = this.call('ControllableParameters') || []; } catch (e) { this.log('error', 'ControllableParameters: ' + e.message); }
    const all = [...base, ...this.state.properties];
    const seen = new Set();
    return all.filter(p => p && p.property && !seen.has(p.property) && seen.add(p.property));
  }

  applyParams(values = {}) {
    for (const p of this.parameters()) this.context[p.property] = convertParam(p, values[p.property]);
  }

  setParam(name, value) {
    const p = this.parameters().find(x => x.property === name);
    if (!p) return;
    this.context[name] = convertParam(p, value);
    const cb = `on${name}Changed`;
    try { if (this.has(cb)) this.call(cb); } catch (e) { this.log('error', `${cb}: ${e.message}`); }
  }

  initialize() {
    const size = this.value('Size', [1, 1]);
    this.state.size = Array.isArray(size) ? [Math.max(1, size[0] | 0), Math.max(1, size[1] | 0)] : [1, 1];
    this.state.ledNames = [...(this.value('LedNames', []) || [])];
    this.state.ledPositions = (this.value('LedPositions', []) || []).map(p => [p[0], p[1]]);
    this.state.name = this.state.name || this.value('Name', path.basename(this.file, '.js'));
    this.state.image = this.value('ImageUrl', '') || '';
    this.applyParams(this.opts.params);
    this.call('Initialize');
    this.dirty = true;
  }

  render() { this.call('Render'); }
  shutdown(suspending = false) { try { this.call('Shutdown', suspending); } catch (e) { this.log('error', 'Shutdown: ' + e.message); } }

  descriptor() {
    const st = this.state;
    return {
      name: st.name,
      size: st.size,
      ledNames: st.ledNames,
      ledPositions: st.ledPositions,
      image: st.image,
      deviceType: String(this.value('DeviceType', 'other') || 'other').toLowerCase(),
      publisher: this.value('Publisher', ''),
      defaultPosition: this.value('DefaultPosition', null),
      defaultScale: this.value('DefaultScale', null),
      subdevices: [...st.subdevices.values()].map(s => ({ ...s })),
      channels: [...st.channels.values()].map(c => ({ ...c })),
      parameters: this.parameters(),
      frameRate: st.frameRate
    };
  }
}

/** Avalia um plugin apenas para ler metadados (sem hardware). */
function probePlugin(file, systemInfo) {
  const inst = new PluginInstance({ file, io: nullIo(), systemInfo, log: () => {} });
  const pid = inst.value('ProductId', []);
  return {
    file,
    name: inst.value('Name', path.basename(file, '.js')),
    vendorId: inst.value('VendorId', null),
    productIds: Array.isArray(pid) ? pid : [pid],
    type: String(inst.value('Type', 'hid') || 'hid').toLowerCase(),
    deviceType: String(inst.value('DeviceType', 'other') || 'other').toLowerCase()
  };
}

module.exports = { PluginInstance, probePlugin, nullIo };
