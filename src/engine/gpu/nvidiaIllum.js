'use strict';
// API OFICIAL de iluminação da NVIDIA (NVAPI "Client Illumination Zones"): a mesma que o GeForce Experience / NVIDIA
// app usam nas placas Founders Edition e nas de parceiros que a implementam. Não escreve em endereços I2C: o driver
// da NVIDIA é quem fala com o controlador de LEDs da placa. Placa sem LEDs (ou de parceiro que não usa a API)
// responde com 0 zonas — e aí nada é escrito.
// Layout das estruturas: cabeçalhos públicos da NVAPI (NV_GPU_CLIENT_ILLUM_ZONE_CONTROL_PARAMS_V1).
const koffi = require('koffi');

const ID = {
  Initialize: 0x0150E828, EnumPhysicalGPUs: 0xE5AC921F, GetFullName: 0xCEEE8E9F, GetPCIIdentifiers: 0x2DDFB66E,
  // ClientIllumZonesGetControl / SetControl (nvapi_interface.h). 0x73C01D58 / 0x57024C62 são os de
  // ClientIllumDevices*, com outra estrutura: o driver os recusava com -9 (versão incompatível) e nada funcionava.
  IllumZonesGetControl: 0x3DBF5764, IllumZonesSetControl: 0x197D065E
};
const ZONE_SIZE = 200;                       // type(4) + ctrlMode(4) + data(128) + rsvd(64)
const ZONES_MAX = 32;
const PARAMS_SIZE = 4 + 4 + 4 + 64 + ZONES_MAX * ZONE_SIZE; // version, bDefault, numIllumZonesControl, rsvd, zones
const PARAMS_VER = PARAMS_SIZE | (1 << 16);
const ZONE_TYPE = { 1: 'rgb', 2: 'colorFixed', 3: 'rgbw', 4: 'singleColor' };
const MODE_MANUAL = 0;

let api = null;
function load() {
  if (api !== null) return api;
  try {
    const lib = koffi.load('nvapi64.dll');
    const query = lib.func('void *nvapi_QueryInterface(uint32 id)');
    const fn = (id, proto) => { const p = query(id); return p ? (...a) => koffi.call(p, proto, ...a) : null; };
    api = {
      init: fn(ID.Initialize, koffi.proto('int NvInit()')),
      enumGpus: fn(ID.EnumPhysicalGPUs, koffi.proto('int NvEnum(_Out_ void **handles, _Out_ int *count)')),
      fullName: fn(ID.GetFullName, koffi.proto('int NvName(void *gpu, _Out_ uint8_t *name)')),
      pciIds: fn(ID.GetPCIIdentifiers, koffi.proto('int NvPci(void *gpu, _Out_ uint32_t *dev, _Out_ uint32_t *sub, _Out_ uint32_t *rev, _Out_ uint32_t *ext)')),
      getControl: fn(ID.IllumZonesGetControl, koffi.proto('int NvIllumGet(void *gpu, _Inout_ uint8_t *params)')),
      setControl: fn(ID.IllumZonesSetControl, koffi.proto('int NvIllumSet(void *gpu, _Inout_ uint8_t *params)'))
    };
    if (!api.init || api.init() !== 0) api = false;
  } catch { api = false; } // sem driver da NVIDIA
  return api;
}

/** GPUs NVIDIA com o que a API de iluminação informa. Só leitura. */
function listGpus() {
  const a = load();
  if (!a) return [];
  const handles = new Array(64).fill(null), count = [0];
  if (a.enumGpus(handles, count) !== 0) return [];
  const out = [];
  for (let i = 0; i < count[0]; i++) {
    const h = handles[i];
    const name = Buffer.alloc(64); a.fullName?.(h, name);
    const dev = [0], sub = [0], rev = [0], ext = [0]; a.pciIds?.(h, dev, sub, rev, ext);
    const zones = readZones(h);
    out.push({ handle: h, name: name.toString('latin1').replace(/\0.*$/s, ''), deviceId: dev[0] >>> 0, subsystemId: sub[0] >>> 0, zones });
  }
  return out;
}

function newParams(bDefault = false) {
  const b = Buffer.alloc(PARAMS_SIZE);
  b.writeUInt32LE(PARAMS_VER, 0);
  b.writeUInt32LE(bDefault ? 1 : 0, 4);
  return b;
}

/** Zonas de luz da placa (tipo e modo atual), ou [] se a API não existir ou a placa não tiver LEDs. */
function readZones(gpu) {
  const a = load();
  if (!a?.getControl) return [];
  const p = newParams(false);
  if (a.getControl(gpu, p) !== 0) return [];
  const n = Math.min(ZONES_MAX, p.readUInt32LE(8));
  const zones = [];
  for (let i = 0; i < n; i++) {
    const o = 76 + i * ZONE_SIZE;
    zones.push({ index: i, type: ZONE_TYPE[p.readUInt32LE(o)] || 'invalid', mode: p.readUInt32LE(o + 4) });
  }
  return zones;
}

/**
 * Cores por zona (só zonas RGB e RGBW, modo manual). colors[i] = [r, g, b]. persist=true grava como padrão da placa
 * (bDefault: volta assim ao ligar o PC, sem o Hydraflow) — só quando a pessoa pede "Salvar no dispositivo".
 */
function setZones(gpu, colors, { brightness = 100, persist = false } = {}) {
  const a = load();
  if (!a?.getControl || !a.setControl) return false;
  const p = newParams(persist);
  if (a.getControl(gpu, p) !== 0) return false;
  p.writeUInt32LE(persist ? 1 : 0, 4);
  const n = Math.min(ZONES_MAX, p.readUInt32LE(8));
  for (let i = 0; i < n; i++) {
    const o = 76 + i * ZONE_SIZE, type = p.readUInt32LE(o), c = colors[i % colors.length] || [0, 0, 0];
    if (type !== 1 && type !== 3) continue; // cor fixa / cor única: só o brilho, não muda aqui
    p.writeUInt32LE(MODE_MANUAL, o + 4);
    p[o + 8] = c[0]; p[o + 9] = c[1]; p[o + 10] = c[2];
    if (type === 1) p[o + 11] = brightness; else { p[o + 11] = 0; p[o + 12] = brightness; } // RGB: R,G,B,bri | RGBW: R,G,B,W,bri
  }
  return a.setControl(gpu, p) === 0;
}

module.exports = { listGpus, readZones, setZones, PARAMS_SIZE };
