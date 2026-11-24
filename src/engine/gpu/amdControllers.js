'use strict';
// Controladores de LED das placas AMD de parceiros, falando pelo I2C da ADL (amdAdl.js). Cada família:
//   leds          quantos LEDs/zonas o Hydraflow mostra
//   verify(bus,a) confirma QUE chip está no endereço antes de qualquer escrita (assinatura ou resposta)
//   init(a)       lista de operações que põem o chip em cor fixa controlada pelo app
//   frame(a,c,p)  operações para mostrar as cores c (array de [r,g,b]); p = últimas cores enviadas (só o que mudou)
// Uma operação é { w: [reg, ...bytes] } (escrita em registrador), { raw: [...] } (I2C puro) e opcionalmente
// wait (ms depois dela: alguns chips precisam de pausa entre comandos). Nada aqui grava na memória permanente
// da placa (os "Save" que existem nesses chips gastam a flash e não são usados).
// Registradores e sequências: mapeados pelo projeto OpenRGB (GPL-2.0-or-later) para esses mesmos controladores.

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const allSame = c => c.every(x => same(x, c[0]));

const FAMILIES = {
  // Sapphire Nitro+ (RX 400/500/Vega): modo "custom" e brilho máximo (nesse chip 0 é o mais forte)
  sapphireV1: {
    leds: 1, label: 'Sapphire Nitro Glow',
    verify: (bus, a) => bus.readByteData(a, 0x00) >= 0,
    init: () => [{ w: [0x00, 0x04] }, { w: [0x01, 0x00] }],
    frame: (_, [c]) => [{ w: [0x03, c[0]] }, { w: [0x04, c[1]] }, { w: [0x05, c[2]] }]
  },
  // Sapphire Nitro+/Toxic/Pure (RX 5000 a 9000): controle externo desligado, modo "custom"
  sapphireV3: {
    leds: 1, label: 'Sapphire Nitro Glow',
    verify: (bus, a) => bus.readByteData(a, 0x10) >= 0,
    init: () => [{ w: [0x0F, 0x00] }, { w: [0x10, 0x06] }],
    frame: (_, [c]) => [{ w: [0x1A, c[0]] }, { w: [0x1B, c[1]] }, { w: [0x1C, c[2]] }]
  },
  // PowerColor Red Devil (RX 5700/6000): assinatura 01 05 00 no registrador 0x90; 12 LEDs; 32 ms entre comandos
  redDevilV1: {
    leds: 12, label: 'PowerColor Red Devil',
    verify: (bus, a) => { const b = bus.readBlock(a, 0x90, 3); return !!b && b[0] === 0x01 && b[1] === 0x05 && b[2] === 0x00; },
    init: () => [{ w: [0x12, 0, 0, 0], wait: 32 }, { w: [0x01, 0x01, 0xFF, 0x32], wait: 32 }],
    frame: (_, c, p) => allSame(c)
      ? (p && allSame(p) && same(p[0], c[0]) ? [] : [{ w: [0x0E, ...c[0]], wait: 32 }])
      : c.flatMap((x, i) => (p && same(p[i], x) ? [] : [{ w: [0x02 + i, ...x], wait: 32 }]))
  },
  // PowerColor Red Devil (RX 7900/9070): assinatura no 0x82; 24 LEDs; sincronia com a placa-mãe desligada; 50 ms
  redDevilV2: {
    leds: 24, label: 'PowerColor Red Devil',
    verify: (bus, a) => { const b = bus.readBlock(a, 0x82, 3); return !!b && b[0] === 0x01 && (b[1] === 0x05 || b[1] === 0x32) && b[2] === 0x00; },
    init: () => [{ w: [0x04, 0, 0, 0], wait: 50 }, { w: [0x01, 0x01, 0xFF, 0x32], wait: 50 }],
    frame: (_, c, p) => allSame(c)
      ? (p && allSame(p) && same(p[0], c[0]) ? [] : [{ w: [0x30, ...c[0]], wait: 50 }, { w: [0x31, ...c[0]], wait: 50 }])
      : c.flatMap((x, i) => (p && same(p[i], x) ? [] : [{ w: [0x10 + i, ...x], wait: 50 }]))
  },
  // ASUS ROG Strix (Radeon): assinatura 0x15 0x89 nos registradores 0x20/0x21; cor fixa e cores diretas
  asusAura: {
    leds: 1, label: 'ASUS Aura (placa de vídeo)',
    verify: (bus, a) => bus.readByteData(a, 0x20) === 0x15 && bus.readByteData(a, 0x21) === 0x89,
    init: () => [{ w: [0x07, 0x01] }],
    frame: (_, [c]) => [{ w: [0x04, c[0]] }, { w: [0x05, c[1]] }, { w: [0x06, c[2]] }]
  },
  // MSI Gaming X/Z (Radeon): 3 zonas, modo fixo 0x13, brilho máximo (5 × 20)
  msi: {
    leds: 3, label: 'MSI Mystic Light (placa de vídeo)',
    verify: (bus, a) => bus.readByteData(a, 0x22) >= 0,
    init: () => [{ w: [0x36, 100] }, { w: [0x22, 0x13] }],
    frame: (_, c) => [{ w: [0x26, 0x00] },
      ...[[0x30, 0x31, 0x32], [0x27, 0x28, 0x29], [0x2A, 0x2B, 0x2C]].flatMap((regs, i) => regs.map((r, k) => ({ w: [r, c[i][k]] })))]
  },
  // Gigabyte AORUS/Gaming (Radeon): comandos de 8 bytes sem registrador; responde 0xAB ao 0xAB; 5 zonas
  gigabyteFusion2: {
    leds: 5, label: 'Gigabyte RGB Fusion 2 (placa de vídeo)',
    verify: (bus, a) => {
      if (bus.rawWrite(a, [0xAB, 0, 0, 0, 0, 0, 0, 0]) < 0) return false;
      const r = bus.rawRead(a, 4);
      return !!r && r[0] === 0xAB && !(r[1] === 0xAB && r[2] === 0xAB && r[3] === 0xAB); // eco puro = não é o chip
    },
    init: () => Array.from({ length: 5 }, (_, z) => ({ raw: [0x88, 0x01, 0x02, 0x63, 0x00, z + 1, 0x00, 0x00] })), // fixo, brilho máx.
    frame: (_, c) => {
      const ops = [];
      ops.push({ raw: [0xB0, 0x01, ...c[0], ...c[1]] });
      ops.push({ raw: [0xB1, 0x01, ...c[2], 0, 0, 0] });
      for (const z of [3, 4]) ops.push({ raw: [0x40, ...c[z], z + 1, 0, 0, 0] });
      return ops;
    }
  }
};

/**
 * Um controlador vivo: guarda as últimas cores pedidas e as envia num ritmo que o chip aguenta, fora do laço do
 * motor (as pausas dos Red Devil travariam os outros dispositivos). Sempre a cor MAIS RECENTE: quadros
 * intermediários são descartados.
 */
function controller(bus, card) {
  const fam = FAMILIES[card.family];
  const addr = card.addr;
  let pending = null, last = null, busy = false, inited = false, errors = 0, onError = () => {};
  const run = op => (op.raw ? bus.rawWrite(addr, op.raw) : bus.writeBlock(addr, op.w[0], op.w.slice(1)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (pending) {
        const colors = pending; pending = null;
        const ops = [...(inited ? [] : fam.init(addr)), ...fam.frame(addr, colors, inited ? last : null)];
        let ok = true;
        for (const op of ops) {
          if (run(op) < 0) { ok = false; break; }
          if (op.wait) await sleep(op.wait);
        }
        if (ok) { inited = true; last = colors; errors = 0; onError(null); }
        else if (++errors >= 3) { onError(`I2C 0x${addr.toString(16)}`); await sleep(1000); }
        await sleep(fam.leds > 4 ? 0 : 15); // ~60 escritas/s no máximo nos chips simples
      }
    } finally { busy = false; }
  }
  return {
    leds: fam.leds, label: fam.label,
    set(colors) {
      const c = Array.from({ length: fam.leds }, (_, i) => (colors[i % colors.length] || [0, 0, 0]).map(v => Math.max(0, Math.min(255, v | 0))));
      pending = c; pump();
    },
    reinit() { inited = false; last = null; },
    onError(fn) { onError = fn; }
  };
}

module.exports = { FAMILIES, controller };
