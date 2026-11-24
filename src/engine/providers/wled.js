'use strict';
// Provedor "wled": controladoras de fita ESP32/ESP8266 na rede.
// Ao vivo: protocolo "realtime UDP" do WLED, porta 21324. DNRGB = [4, segundos até voltar ao efeito próprio,
// índice inicial (2 bytes), R,G,B…], até 489 LEDs por pacote. Gravar: API JSON oficial (preset + preset ao ligar).
const { deviceId, lineDescriptor, ledNames, sampleLeds } = require('../devices');
const { WLED_MAX_LEDS: MAX_LEDS } = require('../protocol');

const PORT = 21324, PER_PACKET = 489, TIMEOUT_S = 2;
const PRESET = 250;
const FX = { static: 0, breathe: 2, rainbow: 9 };

function create(ctx) {
  const { state, t } = ctx;
  let list = [], sock = null;
  const mine = () => [...state.devices.values()].filter(rt => rt.provider === 'wled');
  const nameOf = w => w.name || t('engine.wledStrip', { host: w.host });

  function apply(next) {
    list = (Array.isArray(next) ? next : []).filter(w => w && w.host && w.ledCount > 0);
    ctx.removeProvider('wled');
    for (const w of list) {
      const id = deviceId('wled', w.host), enabled = ctx.isEnabled(id);
      const desc = lineDescriptor({ name: nameOf(w), ledNames: ledNames(Math.min(MAX_LEDS, w.ledCount | 0)), deviceType: 'ledstrip', publisher: 'WLED', scale: 1 });
      desc.frameRate = 60; // sem limite no motor: vai a cada quadro novo
      state.devices.set(id, { id, provider: 'wled', cfg: w, enabled, status: enabled ? 'running' : 'disabled', error: null, fresh: true, desc });
    }
    if (list.length && !sock) {
      sock = require('dgram').createSocket('udp4');
      sock.on('error', e => console.error('WLED:', e.message));
    }
    ctx.pushDevices();
  }

  async function post(host, pathName, body) {
    const r = await fetch(`http://${host}${pathName}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  return {
    name: 'wled',
    configure(payload) { if ('wled' in payload) apply(payload.wled); },
    render() {
      if (!sock) return;
      for (const rt of mine()) {
        if (rt.status !== 'running' || !rt.fresh) continue;
        const f = state.frames[rt.id]?.device;
        if (!f) continue;
        rt.fresh = false;
        const colors = sampleLeds(f, rt.desc.ledPositions);
        for (let start = 0; start < colors.length; start += PER_PACKET) {
          const count = Math.min(PER_PACKET, colors.length - start), pkt = Buffer.alloc(4 + count * 3);
          pkt[0] = 4; pkt[1] = TIMEOUT_S; pkt[2] = start >> 8; pkt[3] = start & 0xff;
          for (let k = 0; k < count; k++) pkt.set(colors[start + k], 4 + k * 3);
          sock.send(pkt, PORT, rt.cfg.host, e => { if (e) console.error('WLED:', e.message); });
        }
      }
    },
    publish: rt => ({
      plugin: { name: t('engine.wledProvider'), file: '' },
      endpoint: { product: rt.desc.name, manufacturer: 'WLED', location: `${rt.cfg.host}:${PORT} (UDP)` },
      descriptor: rt.desc
    }),
    setEnabled: (rt, on) => ctx.toggle(rt, on),
    reload: () => apply(list),
    hardwareSave: () => ({ supported: true, modes: Object.keys(FX) }),
    async save(rt, mode) {
      const colors = sampleLeds(state.frames[rt.id]?.device, rt.desc.ledPositions);
      const avg = [0, 1, 2].map(k => Math.round(colors.reduce((a, c) => a + c[k], 0) / Math.max(1, colors.length)));
      await post(rt.cfg.host, '/json/state', { on: true, seg: [{ id: 0, fx: FX[mode] ?? 0, sx: 128, col: [avg, [0, 0, 0], [0, 0, 0]] }] });
      await post(rt.cfg.host, '/json/state', { psave: PRESET, n: 'Hydraflow', ib: true, sb: true }); // grava o estado acima no preset
      await post(rt.cfg.host, '/json/cfg', { def: { ps: PRESET, on: true } });                       // e carrega ele ao ligar
      return { ok: true, detail: `preset ${PRESET}` };
    },
    relabel() { for (const rt of mine()) rt.desc.name = nameOf(rt.cfg); }
  };
}

module.exports = { create };
