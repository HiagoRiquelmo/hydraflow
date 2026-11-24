'use strict';
// Provedor "ram": pentes de memória Corsair pelo auxiliar SMBus do Hydraflow (src/smbus, roda elevado).
// O motor só entrega as cores ao auxiliar por um soquete local; o SMBus em si é com ele.
const { connectHelper } = require('../../smbus/protocol');
const { deviceId, lineDescriptor, ledNames, sampleLeds, rateLimit, statusHolder } = require('../devices');

function create(ctx) {
  const { state, t } = ctx;
  let cfg = { enabled: false, connFile: '' };
  let client = null;
  const status = statusHolder(ctx.send, 'ram', { connected: false });
  // Cada gravação de cor num pente prende o processador do auxiliar por alguns ms (o driver espera o SMBus terminar):
  // a 30/s em dois pentes isso era ~16% de um núcleo. Então: no máximo 25/s, e diferenças que o olho não vê (até 3
  // níveis de 255 em cada canal) não regravam — só a cada 300 ms, para a cor não ficar presa levemente errada.
  const due = rateLimit(40);
  const SMALL = 3, SMALL_REFRESH_MS = 300;
  const last = new Map(); // id → { rgb, at } última gravação
  const sent = {
    worth(id, rgb, now) {
      const prev = last.get(id);
      if (prev && prev.rgb.length === rgb.length) {
        let max = 0;
        for (let i = 0; i < rgb.length; i++) { const d = Math.abs(rgb[i] - prev.rgb[i]); if (d > max) max = d; }
        if (max === 0 || (max <= SMALL && now - prev.at < SMALL_REFRESH_MS)) return false;
      }
      last.set(id, { rgb, at: now });
      return true;
    },
    forget(id) { if (id === undefined) last.clear(); else last.delete(id); }
  };
  const idOf = addr => deviceId('ram', addr.toString(16));
  const mine = () => [...state.devices.values()].filter(rt => rt.provider === 'ram');
  const nameOf = rt => t('ram.dimmName', { name: rt.dimm.name, n: rt.dimmIndex + 1 });

  function hello(m) {
    ctx.removeProvider('ram');
    sent.forget(); // pentes redetectados podem ter voltado ao estado de fábrica: reenviar tudo
    (m.dimms || []).forEach((d, i) => {
      const id = idOf(d.addr), enabled = ctx.isEnabled(id);
      const rt = { id, provider: 'ram', dimm: d, dimmIndex: i, enabled, status: enabled ? 'running' : 'disabled', error: null };
      rt.desc = lineDescriptor({ name: nameOf(rt), ledNames: ledNames(d.leds), vertical: true, deviceType: 'ram', publisher: 'Hydraflow', scale: 8 });
      state.devices.set(id, rt);
    });
    status.set({ connected: true, bus: m.bus, error: m.error || null, count: (m.dimms || []).length });
    ctx.pushDevices();
  }

  function connect() {
    if (!cfg.enabled || client) return;
    client = connectHelper(cfg.connFile, {
      onMessage: m => {
        if (m.type === 'hello') hello(m);
        else if (m.type === 'error') {
          const rt = state.devices.get(idOf(m.addr));
          if (rt) { rt.error = m.error; ctx.publish(rt); }
        }
      },
      onClose: () => {
        client = null; sent.forget();
        const changed = ctx.removeProvider('ram');
        status.set({ connected: false });
        if (changed) ctx.pushDevices();
      }
    });
  }

  return {
    name: 'ram',
    announce: () => status.announce(),
    configure(payload) {
      if (!payload.ram) return;
      cfg = { ...cfg, ...payload.ram };
      if (cfg.enabled) connect(); else client?.close();
    },
    poll: connect,
    rescan: connect,
    redetect() { client?.send({ cmd: 'detect' }); },
    render(now) {
      if (!client || !due(now)) return;
      for (const rt of mine()) {
        if (rt.status !== 'running') continue;
        const colors = sampleLeds(state.frames[rt.id]?.device, rt.desc.ledPositions);
        if (!colors.length) continue;
        const rgb = colors.flat();
        if (!sent.worth(rt.id, rgb, now)) continue; // só envia quando muda de forma visível (SMBus é lento)
        client.send({ cmd: 'colors', addr: rt.dimm.addr, rgb });
      }
    },
    publish: rt => ({
      plugin: { name: t('engine.ramPlugin'), file: '' },
      endpoint: { product: rt.dimm.name, manufacturer: 'Corsair', location: `SMBus 0x${rt.dimm.addr.toString(16)}`, firmware: rt.dimm.firmware },
      descriptor: rt.desc
    }),
    setEnabled(rt, on) { ctx.toggle(rt, on); sent.forget(rt.id); },
    reload() { client?.send({ cmd: 'detect' }); },
    // a controladora "Corsair DRAM" não tem gravação documentada (o modo de memória do iCUE é fechado)
    hardwareSave: () => ({ supported: false, reason: 'ram' }),
    relabel() { for (const rt of mine()) rt.desc.name = nameOf(rt); },
    shutdown() { client?.close(); }
  };
}

module.exports = { create };
