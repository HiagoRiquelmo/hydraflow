'use strict';
// Hydraflow — controlador próprio para memórias Corsair RGB (Vengeance / Dominator, DDR4 e DDR5) via SMBus.
// Protocolo (fatos de hardware): o controlador de LED do pente responde em 0x18–0x1F (DDR5) ou 0x58–0x5F (DDR4).
//   0x43/0x44  registradores de identificação (somente leitura na detecção)
//   0x61,0x21  inicia leitura das informações; 0x40 lê byte a byte (32 bytes); 0x42 checksum CRC-8
//   0x31/0x32  buffer de cores direto: [qtd_leds, R,G,B..., CRC-8]  (bloco SMBus de até 32 bytes cada)
// Segurança: NUNCA acessa 0x50–0x57 (chip SPD da memória) nem escreve fora dos registradores de cor/informação.
const { sleepSync } = require('../common/sleepSync');

const ADDRESSES = [0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x58, 0x59, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F];
const ID_43 = new Set([0x1A, 0x1B, 0x1C]);
const ID_44 = new Set([0x01, 0x03, 0x04]);

const MODELS = [
  { name: 'Corsair Vengeance RGB Pro DDR4', pids: [0x0100, 0x0101], leds: 10, reverse: false },
  { name: 'Corsair Dominator Platinum RGB DDR4', pids: [0x0200, 0x0201], leds: 12, reverse: true },
  { name: 'Corsair Vengeance RGB Pro SL DDR4', pids: [0x0300, 0x0301], leds: 10, reverse: false },
  { name: 'Corsair Vengeance RGB RS DDR4', pids: [0x0400, 0x0401], leds: 6, reverse: false },
  { name: 'Corsair Dominator Platinum RGB DDR5', pids: [0x0600, 0x0601], leds: 12, reverse: true },
  { name: 'Corsair Dominator Titanium RGB DDR5', pids: [0x0800, 0x0801, 0x0810, 0x0811], leds: 12, reverse: true },
  { name: 'Corsair Vengeance RGB DDR5', pids: [0x0700, 0x0701, 0x0900, 0x0901, 0x0910, 0x0911], leds: 10, reverse: false },
  { name: 'Corsair Vengeance Shugo Series DDR5', pids: [0x0A00, 0x0A01, 0x0A10, 0x0A11], leds: 10, reverse: false },
  { name: 'Corsair Vengeance RGB RS DDR5', pids: [0x0B00, 0x0B01], leds: 6, reverse: false }
];

/** CRC-8 (polinômio 0x07, valor inicial 0, sem reflexão, sem XOR final) */
function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b & 0xFF;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF;
  }
  return c;
}

function readInfo(bus, addr) {
  try {
    bus.writeByteData(addr, 0x61, 0x00);
    bus.writeByteData(addr, 0x21, 0x00);
    const data = [];
    for (let i = 0; i < 32; i++) { const v = bus.readByteData(addr, 0x40); if (v < 0) return null; data.push(v); }
    const sum = bus.readByteData(addr, 0x42);
    if (sum !== crc8(data)) return null;
    return { vid: data[0] | (data[1] << 8), pid: data[2] | (data[3] << 8), firmware: `${data[8]}.${data[9]}.${data[10]}.${data[11]}`, protocol: data[28] };
  } catch { return null; }
}

/** Procura pentes Corsair RGB. Somente leituras de identificação nos endereços de controlador de LED. */
function detect(bus, log = () => {}) {
  const found = [];
  for (const addr of ADDRESSES) {
    const a = bus.readByteData(addr, 0x43);
    if (a >= 0 && ID_43.has(a)) {
      const b = bus.readByteData(addr, 0x44);
      if (ID_44.has(b)) {
        const info = readInfo(bus, addr);
        const model = info && MODELS.find(m => m.pids.includes(info.pid));
        const dimm = {
          addr,
          name: model?.name || (addr < 0x58 ? 'Corsair RGB DDR5' : 'Corsair RGB DDR4'),
          leds: model?.leds || 10,
          reverse: model?.reverse || false,
          pid: info?.pid ?? null,
          firmware: info?.firmware || '',
          protocol: info?.protocol ?? null
        };
        found.push(dimm);
        log(`Memória encontrada em 0x${addr.toString(16)}: ${dimm.name} (${dimm.leds} LEDs${info ? `, fw ${dimm.firmware}, protocolo ${dimm.protocol}` : ''})`);
      }
    }
    sleepSync(10);
  }
  return found;
}

/** Envia as cores diretamente ao pente. rgb: [r,g,b,...] na ordem física dos LEDs (de baixo para cima). */
function setColors(bus, dimm, rgb) {
  const n = dimm.leds;
  const packet = [n];
  for (let i = 0; i < n; i++) {
    const src = dimm.reverse ? n - 1 - i : i;
    packet.push(rgb[src * 3] | 0, rgb[src * 3 + 1] | 0, rgb[src * 3 + 2] | 0);
  }
  packet.push(crc8(packet));
  bus.writeBlockData(dimm.addr, 0x31, packet.slice(0, 32));
  if (packet.length > 32) bus.writeBlockData(dimm.addr, 0x32, packet.slice(32));
}

module.exports = { detect, setColors };
