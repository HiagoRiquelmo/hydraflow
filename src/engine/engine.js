'use strict';
// Motor de dispositivos: roda num utilityProcess separado da interface.
// Cada fonte de dispositivos é um provedor em src/engine/providers (interface em src/engine/devices.js):
//   plugin (HID e virtuais) · ram (auxiliar SMBus) · wled (rede) · gpu (API oficial do fabricante)
// O motor guarda os dispositivos, recebe os quadros de cores da janela e pede a cada provedor que os entregue.
const fs = require('fs');
const { createI18n, DEFAULT_LANG } = require('../common/i18n');

// mensagens que vão para a janela (erros, nomes dos pentes de RAM) no idioma do app; trocado pela mensagem 'config'
let i18n = createI18n(DEFAULT_LANG);
const t = (key, vars) => i18n.t(key, vars);

const port = process.parentPort;
const send = (type, payload) => port.postMessage({ type, payload });

const state = {
  devices: new Map(),      // id -> runtime { id, provider, enabled, status, error, fresh, logs, ... }
  settings: {},            // ajustes por dispositivo (store "devices")
  systemInfo: {},
  cachePath: null,
  shutdownLog: null,
  frames: {},              // id -> último quadro de cores { device, subs, channels }
  loop: null,
  pollTimer: null
};

const MAX_LOG_LINES = 600;

const ctx = {
  state, send, t,
  isEnabled: id => (state.settings[id] || {}).enabled !== false,
  toggle(rt, on) { rt.enabled = !!on; rt.status = rt.enabled ? 'running' : 'disabled'; },
  publish: rt => send('device', publishOf(rt)),
  pushDevices: () => send('devices', [...state.devices.values()].map(publishOf)),
  removeProvider(name) {
    let changed = false;
    // o quadro fica: o dispositivo que volta com a mesma id (rescan, volta da suspensão) já tem cores, sem esperar a janela
    for (const [id, rt] of state.devices) if (rt.provider === name) { state.devices.delete(id); changed = true; }
    return changed;
  },
  /** Log de um dispositivo: os plugins têm o próprio (com o console do plugin); os outros guardam aqui. */
  log(rt, level, msg) {
    if (providers[rt.provider].log?.(rt, level, msg)) return;
    const line = { t: Date.now(), level, msg };
    (rt.logs ||= []).push(line);
    if (rt.logs.length > MAX_LOG_LINES) rt.logs.splice(0, rt.logs.length - MAX_LOG_LINES);
    send('log', { id: rt.id, line });
  },
  scheduleRender
};

const providerList = ['plugin', 'ram', 'wled', 'gpu'].map(name => require(`./providers/${name}`).create(ctx));
const providers = Object.fromEntries(providerList.map(p => [p.name, p]));
const each = (method, ...args) => providerList.forEach(p => p[method]?.(...args));

const hardwareSaveOf = rt => providers[rt.provider].hardwareSave?.(rt) || { supported: false, reason: rt.provider };
function publishOf(rt) {
  return { id: rt.id, status: rt.status, error: rt.error, virtual: !!rt.virtual, provider: rt.provider, ...providers[rt.provider].publish(rt), hardwareSave: hardwareSaveOf(rt) };
}

// ---- salvar no dispositivo: grava no hardware o que está tocando, para continuar depois que o app fecha.
// Só onde o hardware tem memória própria e o protocolo para gravar é conhecido — nunca simulado (ver hardwareSave de cada provedor).
async function saveToHardware({ id, mode }) {
  const rt = state.devices.get(id);
  if (!rt) return { ok: false, error: t('engine.saveNoDevice') };
  const cap = hardwareSaveOf(rt);
  if (!cap.supported) return { ok: false, error: t('engine.saveUnsupported') };
  try {
    const r = await providers[rt.provider].save(rt, cap.modes.includes(mode) ? mode : cap.modes[0]);
    // o plugin mudou parâmetros ao gravar (ex.: "Ao fechar o app" → "Gravado no dispositivo"): o app guarda
    if (r.params) send('deviceParams', { id, params: r.params });
    return { ok: r.ok, detail: r.detail || '', error: r.error };
  } catch (e) { return { ok: false, error: e.message }; }
}

// quadro novo (ou thread HID livre): renderiza já, sem esperar o próximo tique do relógio de 15 ms
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setImmediate(() => { renderQueued = false; renderTick(); });
}
function renderTick() { if (state.devices.size) each('render', Date.now()); }

function withDevice(id, fn) {
  const rt = state.devices.get(id);
  if (!rt) return;
  try { fn(rt, providers[rt.provider]); } catch (e) { ctx.log(rt, 'error', e.message); }
  // recarregar pode ter trocado o objeto (WLED, placa de vídeo) ou tirado o dispositivo (placa não achada de novo)
  const cur = state.devices.get(id);
  if (!cur) { ctx.pushDevices(); return; }
  cur.fresh = true; // ligar, ajuste ou recarregar: renderiza de novo mesmo sem cores novas
  if (cur.inst) cur.inst.dirty = false;
  ctx.publish(cur);
}

/** Últimos logs de cada dispositivo em disco: depois que o app fecha, é o único jeito de ver o que o Shutdown fez. */
function writeShutdownLog(suspending) {
  if (!state.shutdownLog) return;
  const out = [`=== ${new Date().toISOString()} · ${suspending ? 'suspensão' : 'fechando o app'} ===`];
  for (const rt of state.devices.values()) {
    if (!rt.logs?.length) continue;
    out.push(`--- ${rt.id}`);
    for (const l of rt.logs.slice(-40)) out.push(`[${new Date(l.t).toISOString()}] ${l.level}: ${l.msg}`);
  }
  try { fs.writeFileSync(state.shutdownLog, out.join('\n')); } catch (e) { console.error('shutdown-log:', e.message); }
}

function startLoops() {
  clearInterval(state.loop);
  // rede de segurança a ~30 Hz (antes 66 Hz): todo quadro novo já renderiza na hora (scheduleRender, em 'frame');
  // o laço só cobre dispositivos que precisam de reenvio sem cor nova. Metade das acordadas do processo.
  state.loop = setInterval(renderTick, 33);
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => each('poll'), 5000); // aparelhos novos e reconexão com o auxiliar da RAM
}

function applyConfig(payload) {
  if (payload.language && payload.language !== i18n.lang) {
    i18n = createI18n(payload.language);
    each('relabel');
    ctx.pushDevices();
  }
  each('configure', payload);
}

// comandos: os ajustes salvos chegam por 'settings' (gravação no store); setEnabled/setParam/pulse/reload só aplicam ao dispositivo vivo
const commands = {
  init(p) {
    state.settings = p.deviceSettings || {};
    state.systemInfo = p.systemInfo || {};
    state.cachePath = p.cachePath || null;
    state.shutdownLog = p.shutdownLog || null;
    each('announce');
    applyConfig(p);
    each('start');
    startLoops();
  },
  config: applyConfig,
  settings(p) { state.settings[p.id] = p.settings; },
  frame(p) {
    Object.assign(state.frames, p); // inclusive de quem ainda está iniciando: começa já com as cores certas
    for (const id in p) { const rt = state.devices.get(id); if (rt) rt.fresh = true; }
    scheduleRender();
  },
  rescan() { each('rescan'); },
  resume() { each('rescan'); startLoops(); }, // volta da suspensão: o 'shutdown' parou os laços e fechou as conexões
  ramRedetect() { providers.ram.redetect(); },
  hardwareSave(p) { saveToHardware(p || {}).then(r => send('hardwareSaveResult', { id: p?.id, ...r })); },
  setEnabled(p) { withDevice(p.id, (rt, prov) => prov.setEnabled(rt, p.enabled)); },
  setParam(p) { withDevice(p.id, (rt, prov) => prov.setParam?.(rt, p.name, p.value)); },
  pulse(p) { withDevice(p.id, (rt, prov) => prov.pulse?.(rt, p.channel, p.ms)); },
  reload(p) { withDevice(p.id, (rt, prov) => prov.reload(rt)); },
  getLogs(p) { send('logs', { id: p.id, lines: state.devices.get(p.id)?.logs || [] }); },
  clearLogs(p) { const logs = state.devices.get(p.id)?.logs; if (logs) logs.length = 0; },
  shutdown(p) {
    clearInterval(state.loop);
    clearInterval(state.pollTimer);
    each('shutdown', { suspending: !!p?.suspending });
    writeShutdownLog(!!p?.suspending);
    send('stopped', {});
  }
};

port.on('message', ({ data }) => {
  const { type, payload } = data || {};
  if (commands[type]) commands[type](payload || {});
  else console.error('motor: comando desconhecido', type);
});
