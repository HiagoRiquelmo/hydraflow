'use strict';
// Provedor "gpu": placas de vídeo pelas APIs oficiais dos drivers.
//   NVIDIA → API oficial de iluminação do driver (src/engine/gpu/nvidiaIllum.js): Founders Edition e parceiras que a usam
//   AMD    → I2C pela biblioteca oficial do driver, ADL (src/engine/gpu/amdAdl.js), com os controladores dos
//            fabricantes (amdControllers.js) nas placas listadas em amdCards.json (identificadas pelo PCI)
// Placa sem LEDs (ou modelo fora da lista) não vira dispositivo; aparece só na mensagem "gpus" (tela Dispositivos).
const { deviceId, lineDescriptor, ledNames, sampleLeds, rateLimit, changeTracker } = require('../devices');
const AMD_CARDS = require('../gpu/amdCards.json').cards.map(c => ({ ...c, dev: parseInt(c.dev, 16), subVendor: parseInt(c.subVendor, 16), subDevice: parseInt(c.subDevice, 16), addr: parseInt(c.addr, 16) }));

function create(ctx) {
  const { state, t } = ctx;
  let nvidia = null, amd = null, amdCtl = null, enabled = true;
  const due = rateLimit();
  const sent = changeTracker();
  const mine = () => [...state.devices.values()].filter(rt => rt.provider === 'gpu');
  const zoneNames = g => g.zones.map((_, i) => `${t('engine.gpuZone')} ${i + 1}`);
  const amdLedNames = ctl => (ctl.leds === 1 ? [t('engine.gpuZone')] : ledNames(ctl.leds));
  const amdControllers = new Map(); // id → controlador vivo (sobrevive a rescans: não reinicia o chip à toa)

  function detectNvidia(info) {
    let found = [];
    try { nvidia = nvidia || require('../gpu/nvidiaIllum'); found = nvidia.listGpus(); }
    catch (e) { console.error('GPU NVIDIA:', e.message); }
    for (const g of found) {
      info.push({ name: g.name, vendor: 'nvidia', zones: g.zones.length, subsystem: g.subsystemId.toString(16) });
      if (!g.zones.some(z => z.type === 'rgb' || z.type === 'rgbw')) continue;
      const id = deviceId('gpu', 'nv', g.subsystemId.toString(16), g.deviceId.toString(16)), on = ctx.isEnabled(id);
      state.devices.set(id, {
        id, provider: 'gpu', vendor: 'nvidia', gpu: g, enabled: on, status: on ? 'running' : 'disabled', error: null, fresh: true,
        desc: lineDescriptor({ name: g.name, ledNames: zoneNames(g), deviceType: 'gpu', publisher: 'NVIDIA', scale: 6 })
      });
    }
  }

  function detectAmd(info) {
    let adapters = [];
    try { amd = amd || require('../gpu/amdAdl'); amdCtl = amdCtl || require('../gpu/amdControllers'); adapters = amd.listAdapters(); }
    catch (e) { console.error('GPU AMD:', e.message); }
    for (const ad of adapters) {
      const hex = n => n.toString(16).padStart(4, '0');
      const candidates = AMD_CARDS.filter(c => c.dev === ad.dev && c.subVendor === ad.subVendor && c.subDevice === ad.subDevice);
      let card = null, bus = null;
      for (const c of candidates) {
        bus = amd.bus(ad.adapter);
        // confirma o chip (assinatura/resposta) antes de qualquer escrita
        try { if (amdCtl.FAMILIES[c.family].verify(bus, c.addr)) { card = c; break; } } catch {}
      }
      info.push({ name: card?.name || `AMD Radeon (${hex(ad.dev)})`, vendor: 'amd', zones: card ? amdCtl.FAMILIES[card.family].leds : 0, subsystem: `${hex(ad.subVendor)}:${hex(ad.subDevice)}`, known: candidates.length > 0 });
      if (!card) {
        if (candidates.length) console.error(`GPU AMD ${hex(ad.dev)} ${hex(ad.subVendor)}:${hex(ad.subDevice)}: modelo conhecido, mas o chip de LEDs não respondeu`);
        continue;
      }
      const id = deviceId('gpu', 'amd', hex(ad.subVendor) + hex(ad.subDevice), hex(ad.dev)), on = ctx.isEnabled(id);
      let ctl = amdControllers.get(id);
      if (!ctl) { ctl = amdCtl.controller(bus, card); amdControllers.set(id, ctl); }
      const rt = {
        id, provider: 'gpu', vendor: 'amd', amd: { card, adapter: ad, ctl }, enabled: on, status: on ? 'running' : 'disabled', error: null, fresh: true,
        desc: lineDescriptor({ name: card.name, ledNames: amdLedNames(ctl), deviceType: 'gpu', publisher: card.name.split(' ')[0], scale: 6 })
      };
      ctl.onError(err => { const e = err ? t('engine.gpuWriteFailed') : null; if (e !== rt.error) { rt.error = e; ctx.publish(rt); } });
      state.devices.set(id, rt);
    }
  }

  function detect() {
    ctx.removeProvider('gpu');
    sent.forget();
    const info = [];
    if (enabled) { detectNvidia(info); detectAmd(info); }
    ctx.send('gpus', info);
    ctx.pushDevices();
  }

  const writeNvidia = (rt, colors, opts) => {
    const ok = nvidia.setZones(rt.gpu.handle, colors, opts);
    const error = ok ? null : t('engine.gpuWriteFailed');
    if (error !== rt.error) { rt.error = error; ctx.publish(rt); }
    return ok;
  };

  return {
    name: 'gpu',
    // --no-hardware: nem placas de vídeo
    configure(payload) { if ('noHardware' in payload) enabled = !payload.noHardware; },
    start: detect,
    rescan: detect,
    render(now) {
      if (!due(now)) return;
      for (const rt of mine()) {
        if (rt.status !== 'running') continue;
        const colors = sampleLeds(state.frames[rt.id]?.device, rt.desc.ledPositions);
        if (!colors.length || !sent.changed(rt.id, colors)) continue;
        if (rt.vendor === 'amd') rt.amd.ctl.set(colors); else writeNvidia(rt, colors);
      }
    },
    publish: rt => rt.vendor === 'amd'
      ? {
        plugin: { name: t('engine.gpuProvider'), file: '' },
        endpoint: { product: rt.amd.card.name, manufacturer: 'AMD', location: `ADL ${rt.amd.adapter.adapter} · I2C 0x${rt.amd.card.addr.toString(16)}` },
        descriptor: rt.desc
      }
      : {
        plugin: { name: t('engine.gpuProvider'), file: '' },
        endpoint: { product: rt.gpu.name, manufacturer: 'NVIDIA', location: `PCI ${rt.gpu.deviceId.toString(16)} / ${rt.gpu.subsystemId.toString(16)}` },
        descriptor: rt.desc
      },
    setEnabled(rt, on) { ctx.toggle(rt, on); sent.forget(rt.id); if (rt.vendor === 'amd') rt.amd.ctl.reinit(); },
    reload: detect,
    // NVIDIA: zonas com bDefault (o padrão da placa). AMD: os chips têm "salvar", mas gastam a flash — não usado.
    hardwareSave: rt => (rt.vendor === 'amd' ? { supported: false, reason: 'gpu' } : { supported: true, modes: ['static'] }),
    async save(rt) {
      return writeNvidia(rt, sampleLeds(state.frames[rt.id]?.device, rt.desc.ledPositions), { persist: true }) ? { ok: true } : { ok: false, error: t('engine.gpuWriteFailed') };
    },
    relabel() { for (const rt of mine()) rt.desc.ledNames = rt.vendor === 'nvidia' ? zoneNames(rt.gpu) : amdLedNames(rt.amd.ctl); }
  };
}

module.exports = { create };
