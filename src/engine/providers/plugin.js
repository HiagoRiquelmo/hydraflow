'use strict';
// Provedor "plugin": dispositivos HID (e virtuais) controlados por plugins no formato JS, rodando no pluginHost.
const fs = require('fs');
const path = require('path');
const { PluginInstance, probePlugin, nullIo } = require('../pluginHost');
const { walkPlugins, enumerateHid, groupEndpoints, candidatesFor, chooseEndpoint } = require('../discovery');
const { safeId } = require('../devices');

let HID = null;
try { HID = require('node-hid'); } catch { /* sem node-hid: o catálogo avisa (hidAvailable: false) */ }

/**
 * E/S HID de um dispositivo. Fora do Render() tudo é síncrono, como os plugins esperam (inicializar, ler resposta,
 * desligar). Dentro do Render() (beginFrame … endFrame) as escritas vão para a thread do dispositivo (hidWorker.js),
 * que escreve sem travar o motor nem os outros dispositivos. onDone(): quadro escrito no hardware.
 */
function makeHidIo(endpointList, initial, log, onDone) {
  const handles = new Map();
  let current = null, currentPath = null;
  let failures = 0;
  const open = ep => {
    if (!handles.has(ep.path)) handles.set(ep.path, new HID.HID(ep.path));
    current = handles.get(ep.path); currentPath = ep.path;
    return current;
  };
  open(initial);
  const fail = msg => { failures++; if (failures < 4 || failures % 100 === 0) log('error', `HID: ${msg}`); };
  // thread de escrita: criada só se o worker_threads e o node-hid funcionarem nela; senão tudo continua síncrono
  let worker = null, busy = null, batch = null;
  try {
    const { Worker } = require('worker_threads');
    busy = new Int32Array(new SharedArrayBuffer(4));
    worker = new Worker(path.join(__dirname, '..', 'hidWorker.js'), { workerData: { busy: busy.buffer } });
    worker.on('message', m => {
      if (m.type !== 'done') return;
      if (m.error) fail(m.error); else failures = 0;
      onDone?.();
    });
    worker.on('error', e => { log('error', 'HID (thread): ' + e.message); worker = null; Atomics.store(busy, 0, 0); });
  } catch (e) { worker = null; log('warning', 'HID sem thread própria: ' + e.message); }
  // antes de qualquer E/S síncrona: espera a thread terminar o quadro que estiver escrevendo (no máximo 500 ms)
  const drain = () => { if (!worker) return; for (const end = Date.now() + 500; Atomics.load(busy, 0) === 1 && Date.now() < end;) Atomics.wait(busy, 0, 1, 50); };
  const guard = (fn, fallback) => {
    drain();
    try { const r = fn(); failures = 0; return r; } catch (e) { fail(e.message); return fallback; }
  };
  return {
    get failures() { return failures; },
    /** Há thread de escrita (pode morrer no meio do caminho: aí o dispositivo volta ao ritmo do plugin). */
    get threaded() { return !!worker; },
    /** A thread ainda está escrevendo (ou vai escrever) um quadro: o motor espera antes de mandar outro. */
    get busy() { return !!worker && Atomics.load(busy, 0) === 1; },
    beginFrame() { if (worker) batch = []; },
    /** Manda o quadro para a thread. false se não há thread (as escritas já foram feitas, de forma síncrona). */
    endFrame() {
      const bufs = batch; batch = null;
      if (!worker || !bufs) return false;
      if (!bufs.length) return true;
      Atomics.store(busy, 0, 1);
      worker.postMessage({ type: 'batch', path: currentPath, bufs });
      return true;
    },
    write: buf => {
      if (batch) { batch.push(Buffer.from(buf)); return buf.length; }
      return guard(() => current.write(buf), -1);
    },
    read: (_len, timeout) => guard(() => current.readTimeout(Math.max(0, timeout | 0)), null),
    sendFeature: buf => guard(() => current.sendFeatureReport(buf), -1),
    getFeature: (id, len) => guard(() => current.getFeatureReport(id, len), null),
    setEndpoint(q) {
      const ep = endpointList.find(e => e.interface === q.interface &&
        (q.usage === undefined || e.usage === q.usage) && (q.usage_page === undefined || e.usage_page === q.usage_page));
      if (!ep) return false;
      try { open(ep); return true; } catch (e) { log('error', 'set_endpoint: ' + e.message); return false; }
    },
    close() {
      drain();
      if (worker) { try { worker.postMessage({ type: 'close' }); } catch { /* thread já saiu */ } worker = null; }
      for (const h of handles.values()) { try { h.close(); } catch { /* aparelho já desconectado */ } } handles.clear();
    }
  };
}

function create(ctx) {
  const { state, send, t } = ctx;
  const cfg = { pluginFolders: [], virtualDevices: false };
  let catalog = [];
  let lastScanKey = '';
  const mine = () => [...state.devices.values()].filter(rt => rt.provider === 'plugin');

  function loadProbeCache() {
    try { return JSON.parse(fs.readFileSync(state.cachePath, 'utf8')); } catch { return {}; }
  }

  function buildCatalog() {
    send('catalog', { loading: true, errors: [], hidAvailable: !!HID });
    const list = [];
    const errors = [];
    const seen = new Set();          // mesmo plugin em duas fontes: vale a primeira (maior prioridade)
    const cache = state.cachePath ? loadProbeCache() : {};
    const nextCache = {};
    for (const folder of cfg.pluginFolders) {
      for (const file of walkPlugins(folder)) {
        const base = path.basename(file).toLowerCase();
        if (seen.has(base)) continue;
        let stat;
        try { stat = fs.statSync(file); } catch { continue; } // sumiu entre a listagem e a leitura
        const key = `${file}|${stat.size}|${stat.mtimeMs}`;
        let meta = cache[key];
        if (!meta) {
          let text = '';
          try { text = fs.readFileSync(file, 'utf8'); } catch (e) { errors.push({ file, error: e.message }); continue; }
          if (!/export\s+(function|const|let|var)\s+(VendorId|Type)\b/.test(text)) { nextCache[key] = { skip: true }; continue; }
          try { meta = probePlugin(file, state.systemInfo); }
          catch (e) { errors.push({ file, error: e.message }); continue; }
        }
        nextCache[key] = meta;
        if (meta.skip) continue;
        if (meta.type === 'hid' || meta.type === 'virtual') { list.push(meta); seen.add(base); }
      }
    }
    if (state.cachePath) { try { fs.writeFileSync(state.cachePath, JSON.stringify(nextCache)); } catch (e) { console.error('plugin-cache:', e.message); } }
    catalog = list;
    send('catalog', { loading: false, errors: errors.slice(0, 50), hidAvailable: !!HID });
  }

  function start(rt) {
    rt.enabled ??= ctx.isEnabled(rt.id); // dispositivo novo: vale o que está salvo
    if (!rt.enabled) { rt.status = 'disabled'; return; }
    try {
      rt.io = rt.io || (rt.virtual ? nullIo() : makeHidIo(rt.endpoints, rt.endpoint, (l, m) => ctx.log(rt, l, m), () => {
        if (rt.fresh) ctx.scheduleRender(); // chegou quadro novo enquanto este era escrito: vai agora
      }));
      rt.inst = new PluginInstance({
        file: rt.meta.file, io: rt.io, endpoint: rt.endpoint, endpoints: rt.endpoints,
        systemInfo: state.systemInfo, params: (state.settings[rt.id] || {}).params || {},
        log: line => send('log', { id: rt.id, line })
      });
      rt.logs = rt.inst.logs;
      rt.inst.initialize();
      rt.status = 'running';
      rt.error = null;
      rt.errorCount = 0;
    } catch (e) {
      rt.status = 'error';
      rt.error = e.message;
      ctx.log(rt, 'error', 'Initialize falhou: ' + (e.stack || e.message));
    }
  }

  function stop(rt, { close = false, suspending = false } = {}) {
    if (rt.inst && rt.status === 'running') rt.inst.shutdown(suspending);
    rt.status = rt.enabled === false ? 'disabled' : 'stopped';
    if (close && rt.io) { rt.io.close(); rt.io = null; }
  }

  /** true se o dispositivo acabou de falhar de vez (a lista de dispositivos precisa ser republicada). */
  function renderOne(rt, now) {
    if (rt.status !== 'running' || !rt.inst) return false;
    // com thread própria de escrita, quem limita o ritmo é o próprio hardware: enquanto o quadro anterior está sendo
    // escrito, espera (o quadro novo continua "fresh" e vai assim que a thread terminar). Sem thread, vale o ritmo do plugin.
    const threaded = !!rt.io?.threaded;
    if (threaded && rt.io.busy) return false;
    const minGap = threaded ? 8 : 1000 / rt.inst.state.frameRate - 2;
    if (rt.lastRender && now - rt.lastRender < minGap) return false;
    // cores iguais não vão de novo ao hardware: só renderiza com quadro novo, piscada em andamento ou comando
    // (a janela reenvia as cores a cada 1 s mesmo paradas, o que mantém vivos os dispositivos que voltam ao padrão sozinhos)
    if (rt.lastRender && !rt.fresh && !rt.inst.pulse.channels.size) return false;
    rt.fresh = false;
    rt.lastRender = now;
    const f = state.frames[rt.id];
    if (f) rt.inst.frame = f;
    let failed = false;
    try {
      rt.io?.beginFrame?.();
      rt.inst.render();
      rt.io?.endFrame?.();
      rt.errorCount = 0;
    } catch (e) {
      rt.io?.endFrame?.();
      rt.errorCount = (rt.errorCount || 0) + 1;
      if (rt.errorCount < 4) ctx.log(rt, 'error', 'Render: ' + e.message);
      if (rt.errorCount > 60) { rt.status = 'error'; rt.error = t('engine.renderFailed', { error: e.message }); failed = true; }
    }
    if (rt.io && rt.io.failures > 200) { rt.status = 'error'; rt.error = t('engine.hidNoAnswer'); failed = true; }
    if (rt.inst.dirty) { rt.inst.dirty = false; ctx.publish(rt); }
    return failed;
  }

  function scan(force = false) {
    let endpoints = [];
    if (HID) { try { endpoints = enumerateHid(HID); } catch (e) { send('error', t('engine.hidListFailed', { error: e.message })); } }
    const key = endpoints.map(e => e.path).sort().join('|') + '|v' + cfg.virtualDevices + '|' + catalog.length;
    if (!force && key === lastScanKey) return;
    lastScanKey = key;

    const seen = new Set();
    for (const [gid, eps] of groupEndpoints(endpoints)) {
      const candidates = candidatesFor(catalog, eps);
      for (const meta of candidates) {
        // o sufixo com o nome do plugin só existe quando há mais de um candidato: mudar isso trocaria as ids salvas
        const id = candidates.length > 1 ? `${gid}:${safeId(path.basename(meta.file, '.js'))}` : gid;
        if (state.devices.has(id)) { seen.add(id); break; }
        let chosen = null;
        try { chosen = chooseEndpoint(meta, eps, state.systemInfo); }
        catch (e) { console.error(`Validate (${path.basename(meta.file)}):`, e.message); continue; }
        if (!chosen) continue;
        const rt = { id, provider: 'plugin', meta, endpoint: chosen, endpoints: eps, virtual: false, status: 'starting' };
        state.devices.set(id, rt);
        seen.add(id);
        start(rt);
        break; // um plugin por dispositivo físico
      }
    }

    if (cfg.virtualDevices) {
      for (const meta of catalog.filter(m => m.type === 'virtual')) {
        const id = 'virtual:' + safeId(path.basename(meta.file, '.js').toLowerCase());
        seen.add(id);
        if (state.devices.has(id)) continue;
        const rt = { id, provider: 'plugin', meta, endpoint: { vendor_id: 0, product_id: 0, interface: -1, product: 'Virtual' }, endpoints: [], virtual: true, status: 'starting' };
        state.devices.set(id, rt);
        start(rt);
      }
    }

    for (const rt of mine()) if (!seen.has(rt.id)) { stop(rt, { close: true }); state.devices.delete(rt.id); }
    ctx.pushDevices();
  }

  const stopAll = opts => { for (const rt of mine()) stop(rt, { close: true, ...opts }); };

  return {
    name: 'plugin',
    configure(payload) {
      let changed = false;
      if (payload.pluginFolders) { cfg.pluginFolders = payload.pluginFolders; buildCatalog(); changed = true; }
      if ('virtualDevices' in payload) { changed = changed || cfg.virtualDevices !== !!payload.virtualDevices; cfg.virtualDevices = !!payload.virtualDevices; }
      if (changed) scan(true);
    },
    poll: () => scan(false),
    rescan() { stopAll(); ctx.removeProvider('plugin'); buildCatalog(); scan(true); },
    render(now) {
      let failed = false;
      for (const rt of mine()) if (renderOne(rt, now)) failed = true;
      if (failed) ctx.pushDevices();
    },
    publish: rt => ({ plugin: { name: rt.meta.name, file: rt.meta.file }, endpoint: rt.endpoint, descriptor: rt.inst ? rt.inst.descriptor() : null }),
    setEnabled(rt, on) {
      if (on) { rt.enabled = true; start(rt); }
      else { stop(rt); rt.enabled = false; rt.status = 'disabled'; }
    },
    reload(rt) { stop(rt); rt.inst = null; start(rt); ctx.log(rt, 'info', 'Plugin recarregado.'); },
    // ASUS Aura e afins: o plugin exporta SaveToDevice(plano) e HardwareSaveModes()
    hardwareSave: rt => (!rt.virtual && rt.inst?.has('SaveToDevice') ? { supported: true, modes: rt.inst.value('HardwareSaveModes', ['static']) } : { supported: false, reason: 'plugin' }),
    async save(rt, mode) {
      // fora do Render(): E/S síncrona, esperando a thread HID terminar o quadro em andamento
      const r = rt.inst.call('SaveToDevice', { mode }) || {};
      if (r.ok === false) return { ok: false, error: r.error || t('engine.saveFailed') };
      if (r.params) for (const [k, v] of Object.entries(r.params)) rt.inst.setParam(k, v);
      return { ok: true, detail: r.detail || '', params: r.params };
    },
    setParam(rt, name, value) { rt.inst?.setParam(name, value); },
    pulse(rt, channel, ms) {
      if (!rt.inst) return;
      rt.inst.pulse.started = Date.now();
      const chans = channel ? [channel] : [...rt.inst.state.channels.keys()];
      chans.forEach(c => rt.inst.pulse.channels.add(c));
      setTimeout(() => { chans.forEach(c => rt.inst?.pulse.channels.delete(c)); rt.fresh = true; }, ms);
    },
    log(rt, level, msg) { if (rt.inst) { rt.inst.log(level, msg); return true; } return false; },
    shutdown(opts) { stopAll(opts); }
  };
}

module.exports = { create };
