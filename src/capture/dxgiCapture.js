'use strict';
// Captura de tela de baixa latência para o Ambiente da Tela (roda num utilityProcess próprio).
// DXGI Desktop Duplication: o Windows entrega o quadro da tela na placa de vídeo assim que ele muda; a própria
// placa reduz a imagem (mipmaps = média de blocos 2×2 repetida) e só uma miniatura (~120×68) vem para a CPU.
// Sem módulo nativo compilado: as interfaces COM do Direct3D são chamadas pelo índice na vtable via koffi.
// Mensagens: recebe { type: 'start', fps } / { type: 'stop' }; envia { type: 'frame', w, h, data (RGBA) } e
// { type: 'status', ok, error }.
const koffi = require('koffi');
const { createI18n } = require('../common/i18n');
// erros que vão para o console do Ambiente da Tela, no idioma do app (vem na mensagem 'start')
let tr = createI18n('pt-BR').t;

const d3d11 = koffi.load('d3d11.dll');
const dxgi = koffi.load('dxgi.dll');
const kernel32 = koffi.load('kernel32.dll');
const CreateDXGIFactory1 = dxgi.func('long __stdcall CreateDXGIFactory1(uint8_t *riid, _Out_ void **factory)');
const D3D11CreateDevice = d3d11.func('long __stdcall D3D11CreateDevice(void *adapter, int type, void *sw, uint32 flags, void *levels, uint32 n, uint32 sdk, _Out_ void **dev, _Out_ int *level, _Out_ void **ctx)');
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(_Out_ uint8_t *dst, void *src, size_t n)');

// ---- COM: chamada pelo índice da vtable
const P = {
  QueryInterface: koffi.proto('long __stdcall QI(void *self, uint8_t *riid, _Out_ void **out)'),
  Release: koffi.proto('uint32 __stdcall Rel(void *self)'),
  EnumIdx: koffi.proto('long __stdcall EnumIdx(void *self, uint32 i, _Out_ void **out)'),            // EnumAdapters / EnumOutputs
  GetDesc: koffi.proto('long __stdcall GetDesc(void *self, _Out_ uint8_t *desc)'),                    // IDXGIOutput / Duplication
  DuplicateOutput: koffi.proto('long __stdcall Dup(void *self, void *dev, _Out_ void **dup)'),
  DuplicateOutput1: koffi.proto('long __stdcall Dup1(void *self, void *dev, uint32 flags, uint32 n, uint32_t *formats, _Out_ void **dup)'),
  AcquireNextFrame: koffi.proto('long __stdcall Acq(void *self, uint32 ms, _Out_ uint8_t *info, _Out_ void **res)'),
  ReleaseFrame: koffi.proto('long __stdcall RelF(void *self)'),
  CreateTexture2D: koffi.proto('long __stdcall CT(void *self, uint8_t *desc, void *init, _Out_ void **tex)'),
  CreateSRV: koffi.proto('long __stdcall SRV(void *self, void *res, void *desc, _Out_ void **srv)'),
  CopySubresourceRegion: koffi.proto('void __stdcall CSR(void *self, void *dst, uint32 dsub, uint32 x, uint32 y, uint32 z, void *src, uint32 ssub, void *box)'),
  GenerateMips: koffi.proto('void __stdcall GM(void *self, void *srv)'),
  Map: koffi.proto('long __stdcall Map(void *self, void *res, uint32 sub, uint32 type, uint32 flags, _Out_ uint8_t *mapped)'),
  Unmap: koffi.proto('void __stdcall Unmap(void *self, void *res, uint32 sub)')
};
function vcall(obj, index, proto, ...args) {
  const vtbl = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtbl, index * koffi.sizeof('void *'), 'void *');
  return koffi.call(fn, proto, obj, ...args);
}
const release = o => { if (o) try { vcall(o, 2, P.Release); } catch {} };
const ok = hr => hr >= 0;
const hex = hr => '0x' + (hr >>> 0).toString(16).toUpperCase();

function guid(s) {
  const h = s.replace(/-/g, ''), b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0); b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4); b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}
const IID = {
  Factory1: guid('770aae78-f26f-4dba-a829-253c83d1b387'),
  Output1: guid('00cddea8-939b-4b83-a340-a685226666cc'),
  Output5: guid('80a07424-ab52-42eb-833c-0c42fd282d98'),
  Texture2D: guid('6f15aaf2-d208-4e89-9ab4-489535d34f9c')
};
const BGRA = 87, WAIT_TIMEOUT = 0x887A0027 | 0, ACCESS_LOST = 0x887A0026 | 0;

// índices nas vtables (ordem dos métodos nos cabeçalhos do Windows SDK)
const V = {
  factoryEnumAdapters: 7, adapterEnumOutputs: 7, outputGetDesc: 7, output1Duplicate: 22, output5Duplicate1: 26,
  dupGetDesc: 7, dupAcquire: 8, dupRelease: 14,
  devCreateTexture2D: 5, devCreateSRV: 7,
  ctxMap: 14, ctxUnmap: 15, ctxCopySub: 46, ctxGenerateMips: 54
};

function texDesc(w, h, { mips = 1, usage = 0, bind = 0, cpu = 0, misc = 0 }) {
  const b = Buffer.alloc(44);
  b.writeUInt32LE(w, 0); b.writeUInt32LE(h, 4); b.writeUInt32LE(mips, 8); b.writeUInt32LE(1, 12); b.writeUInt32LE(BGRA, 16);
  b.writeUInt32LE(1, 20); b.writeUInt32LE(0, 24); b.writeUInt32LE(usage, 28); b.writeUInt32LE(bind, 32); b.writeUInt32LE(cpu, 36); b.writeUInt32LE(misc, 40);
  return b;
}

class Duplicator {
  constructor() { this.objs = {}; }

  /** Acha o monitor principal (o que contém o ponto 0,0), cria o dispositivo na placa dele e começa a duplicar. */
  open() {
    this.close();
    const o = this.objs, out = [null];
    if (!ok(CreateDXGIFactory1(IID.Factory1, out))) throw new Error(tr('capture.noDxgi'));
    o.factory = out[0];
    let chosen = null;
    for (let a = 0; !chosen && ok(vcall(o.factory, V.factoryEnumAdapters, P.EnumIdx, a, out)); a++) {
      const adapter = out[0];
      for (let i = 0; ok(vcall(adapter, V.adapterEnumOutputs, P.EnumIdx, i, out)); i++) {
        const output = out[0], d = Buffer.alloc(96);
        vcall(output, V.outputGetDesc, P.GetDesc, d);
        const l = d.readInt32LE(64), t = d.readInt32LE(68), r = d.readInt32LE(72), b = d.readInt32LE(76);
        if (!chosen && l <= 0 && t <= 0 && r > 0 && b > 0) chosen = { adapter, output };
        else release(output);
      }
      if (!chosen) release(adapter);
    }
    if (!chosen) throw new Error(tr('capture.noMonitor'));
    o.adapter = chosen.adapter; o.output = chosen.output;
    const dev = [null], lvl = [0], ctx = [null];
    const hr = D3D11CreateDevice(o.adapter, 0 /* UNKNOWN: usa o adaptador dado */, null, 0x20 /* BGRA */, null, 0, 7, dev, lvl, ctx);
    if (!ok(hr)) throw new Error(tr('capture.noD3d', { code: hex(hr) }));
    o.dev = dev[0]; o.ctx = ctx[0];
    // Output5 (Windows 10 1703+): pede BGRA 8 bits mesmo com HDR ligado; senão, o caminho clássico
    let dupHr;
    if (ok(vcall(o.output, 0, P.QueryInterface, IID.Output5, out))) {
      o.output5 = out[0];
      dupHr = vcall(o.output5, V.output5Duplicate1, P.DuplicateOutput1, o.dev, 0, 1, new Uint32Array([BGRA]), out);
    }
    if (!o.output5 || !ok(dupHr)) {
      if (!ok(vcall(o.output, 0, P.QueryInterface, IID.Output1, out))) throw new Error(tr('capture.noDuplication'));
      o.output1 = out[0];
      dupHr = vcall(o.output1, V.output1Duplicate, P.DuplicateOutput, o.dev, out);
    }
    if (!ok(dupHr)) throw new Error(tr('capture.duplicateFailed', { code: hex(dupHr) }));
    o.dup = out[0];
    const dd = Buffer.alloc(36);
    vcall(o.dup, V.dupGetDesc, P.GetDesc, dd);
    this.W = dd.readUInt32LE(0); this.H = dd.readUInt32LE(4);
    // nível de mip com largura perto de 120 px: 1920→120 (nível 4), 2560→160, 3840→120 (nível 5)
    this.level = 0;
    while ((this.W >> (this.level + 1)) >= 100 && (this.H >> (this.level + 1)) >= 40) this.level++;
    this.sw = Math.max(1, this.W >> this.level); this.sh = Math.max(1, this.H >> this.level);
    o.mipTex = this.create(texDesc(this.W, this.H, { mips: this.level + 1, bind: 0x28, misc: 0x1 }));
    if (!ok(vcall(o.dev, V.devCreateSRV, P.CreateSRV, o.mipTex, null, out))) throw new Error(tr('capture.mipsFailed'));
    o.srv = out[0];
    o.staging = this.create(texDesc(this.sw, this.sh, { usage: 3, cpu: 0x20000 }));
    this.info = Buffer.alloc(48); this.mapped = Buffer.alloc(16);
    this.bgra = Buffer.alloc(this.sw * this.sh * 4);
    this.rgba = new Uint8Array(this.bgra.length); // reaproveitado: o postMessage copia
  }

  create(desc) {
    const out = [null];
    const hr = vcall(this.objs.dev, V.devCreateTexture2D, P.CreateTexture2D, desc, null, out);
    if (!ok(hr)) throw new Error(tr('capture.textureFailed', { code: hex(hr) }));
    return out[0];
  }

  /** Espera até `ms` por um quadro novo. Devolve { w, h, data } (RGBA), null se a tela não mudou. */
  grab(ms) {
    const o = this.objs, res = [null];
    const hr = vcall(o.dup, V.dupAcquire, P.AcquireNextFrame, ms, this.info, res);
    if (hr === WAIT_TIMEOUT) return null;
    if (hr === ACCESS_LOST) { this.open(); return null; } // resolução trocada, UAC, tela cheia exclusiva…
    if (!ok(hr)) throw new Error(tr('capture.grabFailed', { code: hex(hr) }));
    const tex = [null];
    try {
      if (!ok(vcall(res[0], 0, P.QueryInterface, IID.Texture2D, tex))) return null;
      vcall(o.ctx, V.ctxCopySub, P.CopySubresourceRegion, o.mipTex, 0, 0, 0, 0, tex[0], 0, null);
    } finally { release(tex[0]); release(res[0]); vcall(o.dup, V.dupRelease, P.ReleaseFrame); }
    vcall(o.ctx, V.ctxGenerateMips, P.GenerateMips, o.srv);
    vcall(o.ctx, V.ctxCopySub, P.CopySubresourceRegion, o.staging, 0, 0, 0, 0, o.mipTex, this.level, null);
    if (!ok(vcall(o.ctx, V.ctxMap, P.Map, o.staging, 0, 1 /* READ */, 0, this.mapped))) return null;
    try {
      const ptr = koffi.decode(this.mapped, 'void *'), pitch = this.mapped.readUInt32LE(8), row = this.sw * 4;
      if (pitch === row) RtlMoveMemory(this.bgra, ptr, row * this.sh);
      else { // linhas alinhadas pela placa (pitch > largura): copia o bloco e tira o enchimento
        const all = Buffer.alloc(pitch * this.sh);
        RtlMoveMemory(all, ptr, pitch * (this.sh - 1) + row);
        for (let y = 0; y < this.sh; y++) all.copy(this.bgra, y * row, y * pitch, y * pitch + row);
      }
    } finally { vcall(o.ctx, V.ctxUnmap, P.Unmap, o.staging, 0); }
    const rgba = this.rgba, bgra = this.bgra;
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255; }
    return { w: this.sw, h: this.sh, data: rgba };
  }

  close() {
    const o = this.objs;
    for (const k of ['staging', 'srv', 'mipTex', 'dup', 'output1', 'output5', 'ctx', 'dev', 'output', 'adapter', 'factory']) { release(o[k]); o[k] = null; }
  }
}

// ---- laço do processo
const port = process.parentPort;
const dup = new Duplicator();
let running = false, fps = 30, timer = null;

// Cada volta espera o PRÓXIMO quadro do Windows (AcquireNextFrame bloqueia sem gastar CPU) e o lê assim que ele
// existe. Antes o laço dormia até completar 1/30 s: um quadro apresentado logo depois da leitura esperava até 33 ms
// (medido: 18 ms em média). `fps` agora é só o teto (o monitor e o conteúdo da tela é que ditam o ritmo).
function loop() {
  if (!running) return;
  const t0 = Date.now();
  let f = null;
  try {
    f = dup.grab(100); // até 100 ms parado esperando; volta para o laço de eventos (mensagens de "stop") entre esperas
    if (f) port.postMessage({ type: 'frame', w: f.w, h: f.h, data: f.data });
  } catch (e) {
    port.postMessage({ type: 'status', ok: false, error: e.message });
    running = false; dup.close();
    return;
  }
  const gap = f ? 1000 / fps - (Date.now() - t0) : 0;
  timer = gap > 0 ? setTimeout(loop, gap) : setImmediate(loop);
}

port.on('message', ({ data }) => {
  if (data?.type === 'start') {
    fps = Math.max(10, Math.min(125, data.fps || 125));
    if (data.lang) tr = createI18n(data.lang).t;
    // já capturando (a janela recarregou): só confirma
    if (running) return port.postMessage({ type: 'status', ok: true, w: dup.sw, h: dup.sh, screen: [dup.W, dup.H] });
    try { dup.open(); running = true; port.postMessage({ type: 'status', ok: true, w: dup.sw, h: dup.sh, screen: [dup.W, dup.H] }); loop(); }
    catch (e) { port.postMessage({ type: 'status', ok: false, error: e.message }); dup.close(); }
  } else if (data?.type === 'stop') {
    running = false; clearTimeout(timer); clearImmediate(timer); dup.close();
  }
});
