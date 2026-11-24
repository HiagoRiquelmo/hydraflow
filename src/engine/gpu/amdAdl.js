'use strict';
// Barramento I2C das placas de vídeo AMD pela biblioteca oficial do driver (ADL, atiadlxx.dll), sem OpenRGB.
// É por esse barramento que os fabricantes (Sapphire, PowerColor, ASUS, MSI, Gigabyte) ligam o chip de LEDs da placa.
// O driver da AMD é quem fala com o hardware; aqui só se monta o pedido (ADLI2C) e se chama
// ADL2_Display_WriteAndReadI2C. Sem driver AMD (PC só com NVIDIA/Intel), load() devolve false e nada acontece.
// Estruturas: ADL SDK oficial (GPUOpen display-library, adl_structures.h / adl_defines.h).
const koffi = require('koffi');

const ADL_OK = 0;
const ACTION_READ = 1, ACTION_WRITE = 2;
const LINE_OEM = 1;               // linha I2C onde os fabricantes põem o chip de LEDs
const SPEED_KHZ = 100;
const ADAPTER_INFO_SIZE = 1572;   // AdapterInfo (Windows): 2 int + 256 + 4 int + 2×256 + 2 int + 3×256 + int
const OFF = { index: 4, bus: 264, vendor: 276, pnp: 1312 };
const AMD_VENDOR = 0x1002;

let api = null;
function load() {
  if (api !== null) return api;
  try {
    const lib = koffi.load('atiadlxx.dll');
    const crt = koffi.load('msvcrt.dll');
    const malloc = crt.func('void *malloc(size_t size)');
    // a ADL pede memória por este retorno (ADL_MAIN_MALLOC_CALLBACK); fica registrado enquanto o processo vive
    const AllocCb = koffi.proto('void *__stdcall HfAdlAlloc(int size)');
    const alloc = koffi.register(size => malloc(size), koffi.pointer(AllocCb));
    const I2C = koffi.struct('HfADLI2C', {
      iSize: 'int', iLine: 'int', iAddress: 'int', iOffset: 'int', iAction: 'int', iSpeed: 'int', iDataSize: 'int', pcData: 'uint8_t *'
    });
    const f = {
      create: lib.func('int __stdcall ADL2_Main_Control_Create(HfAdlAlloc *cb, int connected, _Out_ void **ctx)'),
      count: lib.func('int __stdcall ADL2_Adapter_NumberOfAdapters_Get(void *ctx, _Out_ int *n)'),
      info: lib.func('int __stdcall ADL2_Adapter_AdapterInfo_Get(void *ctx, _Inout_ uint8_t *info, int size)'),
      i2c: lib.func('int __stdcall ADL2_Display_WriteAndReadI2C(void *ctx, int adapter, _Inout_ HfADLI2C *req)')
    };
    const ctx = [null];
    if (f.create(alloc, 1, ctx) !== ADL_OK || !ctx[0]) { api = false; return api; }
    api = { ...f, ctx: ctx[0], I2C };
  } catch { api = false; } // sem driver da AMD
  return api;
}

/** Placas AMD (uma por barramento PCI) com os IDs lidos do PNP do Windows: PCI\VEN_1002&DEV_73BF&SUBSYS_E4391DA2 */
function listAdapters() {
  const a = load();
  if (!a) return [];
  const n = [0];
  if (a.count(a.ctx, n) !== ADL_OK || n[0] <= 0) return [];
  const buf = Buffer.alloc(ADAPTER_INFO_SIZE * n[0]);
  for (let i = 0; i < n[0]; i++) buf.writeInt32LE(ADAPTER_INFO_SIZE, i * ADAPTER_INFO_SIZE);
  if (a.info(a.ctx, buf, buf.length) !== ADL_OK) return [];
  const out = [], seenBus = new Set();
  for (let i = 0; i < n[0]; i++) {
    const o = i * ADAPTER_INFO_SIZE;
    const bus = buf.readInt32LE(o + OFF.bus);
    if (seenBus.has(bus)) continue; // cada saída de vídeo aparece como um "adaptador"; a placa é a mesma
    const pnp = buf.toString('latin1', o + OFF.pnp, o + OFF.pnp + 256).replace(/\0.*$/s, '');
    const m = pnp.match(/VEN_([0-9A-F]{4}).*DEV_([0-9A-F]{4}).*SUBSYS_([0-9A-F]{4})([0-9A-F]{4})/i);
    if (!m || parseInt(m[1], 16) !== AMD_VENDOR) continue;
    seenBus.add(bus);
    out.push({
      adapter: buf.readInt32LE(o + OFF.index), bus,
      vendor: AMD_VENDOR, dev: parseInt(m[2], 16), subDevice: parseInt(m[3], 16), subVendor: parseInt(m[4], 16), pnp
    });
  }
  return out;
}

/**
 * Operações SMBus/I2C num adaptador (mesma semântica do i2c-dev do Linux, que é como esses controladores foram
 * documentados). Todas devolvem -1 em erro (ninguém respondeu no endereço, driver recusou).
 */
function bus(adapter) {
  const a = load();
  // pcData em memória nativa (o driver escreve nela na leitura); copiada de/para o Buffer de quem chamou
  const xfer = (addr, action, offset, data) => {
    if (!a) return -1;
    const type = koffi.array('uint8_t', data.length);
    const mem = koffi.alloc('uint8_t', data.length);
    try {
      koffi.encode(mem, type, [...data]);
      const req = { iSize: koffi.sizeof(a.I2C), iLine: LINE_OEM, iAddress: addr << 1, iOffset: offset, iAction: action, iSpeed: SPEED_KHZ, iDataSize: data.length, pcData: mem };
      if (a.i2c(a.ctx, adapter, req) !== ADL_OK) return -1;
      if (action === ACTION_READ) Buffer.from(koffi.decode(mem, type)).copy(data);
      return 0;
    } catch { return -1; } finally { koffi.free(mem); }
  };
  return {
    /** Lê n bytes a partir do registrador reg. Buffer ou null. */
    readBlock(addr, reg, n) { const b = Buffer.alloc(n); return xfer(addr, ACTION_READ, reg, b) === 0 ? b : null; },
    readByteData(addr, reg) { const b = this.readBlock(addr, reg, 1); return b ? b[0] : -1; },
    /** Escreve bytes no registrador reg (o registrador vai como primeiro byte). */
    writeBlock(addr, reg, bytes) { return xfer(addr, ACTION_WRITE, 0, Buffer.from([reg, ...bytes])); },
    writeByteData(addr, reg, val) { return this.writeBlock(addr, reg, [val]); },
    /** I2C puro, sem registrador (Gigabyte). */
    rawWrite(addr, bytes) { return xfer(addr, ACTION_WRITE, 0, Buffer.from(bytes)); },
    rawRead(addr, n) { const b = Buffer.alloc(n); return xfer(addr, ACTION_READ, 0, b) === 0 ? b : null; }
  };
}

module.exports = { load, listAdapters, bus, ADAPTER_INFO_SIZE };
