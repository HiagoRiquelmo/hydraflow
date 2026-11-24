'use strict';
// Tela de watercoolers: encontra o cooler e manda quadros JPEG para ela.
// Hoje fala o protocolo das telas Gamdias (AURA GL360 LCD, CHIONE LCD) — ver docs/protocolo-tela-gamdias.md.
// Outro fabricante entra como mais um item em DRIVERS (detectar + abrir + enviar quadro).
const { regQuery: reg, powershell, psQuote } = require('../common/winsys');

// textos no idioma do app (o principal chama setTranslator; sem ele, as chaves aparecem como estão)
let tr = (key, vars) => key + (vars ? ' ' + JSON.stringify(vars) : '');
const setTranslator = fn => { tr = fn; };

// ---------- protocolo Gamdias (funções puras, testadas em scripts/check.js) ----------
const HEAD = 0x5A, ESC = 0x5B;

/** Moldura de um comando: 0x5A | tamanho(2) | texto | soma | 0x5A, com 0x5A/0x5B escapados no meio. */
function frame(text) {
  const body = Buffer.from(text, 'ascii');
  const total = body.length + 5;
  const raw = Buffer.alloc(total);
  raw[0] = HEAD; raw[1] = (total >> 8) & 0xff; raw[2] = total & 0xff;
  body.copy(raw, 3);
  let sum = 0;
  for (let i = 1; i < total - 2; i++) sum += raw[i];
  raw[total - 2] = sum & 0xff; raw[total - 1] = HEAD;
  const out = [raw[0]];
  for (let i = 1; i < total - 1; i++) {
    const b = raw[i];
    if (b === HEAD) out.push(ESC, 0x01); else if (b === ESC) out.push(ESC, 0x02); else out.push(b);
  }
  out.push(HEAD);
  return Buffer.from(out);
}

/**
 * Lê a primeira resposta completa de `buf` (a tela responde na mesma moldura). Devolve null se ainda falta chegar
 * algo; senão { reply, rest }, com reply = { seq, status, headers, json } ou { error } (soma ou tamanho errados).
 * Texto da resposta: "<seq> <status>\r\nAckNumber=1\r\n[ContentType=json\r\nContentLength=n\r\n]\r\n[json]".
 */
function parseReply(buf) {
  const start = buf.indexOf(HEAD);
  if (start < 0) return null;
  const end = buf.indexOf(HEAD, start + 1);
  if (end < 0) return null;
  const rest = buf.subarray(end + 1);
  const raw = [];
  for (let i = start + 1; i < end; i++) {
    if (buf[i] === ESC) raw.push(buf[++i] === 0x01 ? HEAD : ESC); else raw.push(buf[i]);
  }
  // error: código (short | checksum | nostatus), traduzido por quem mostra
  if (raw.length < 4) return { reply: { error: 'short' }, rest };
  let sum = 0;
  for (let i = 0; i < raw.length - 1; i++) sum += raw[i];
  if ((sum & 0xff) !== raw[raw.length - 1] || ((raw[0] << 8) | raw[1]) !== raw.length + 2) return { reply: { error: 'checksum' }, rest };
  const text = Buffer.from(raw.slice(2, -1)).toString('latin1');
  const m = text.match(/^(\d+) (\d{3})\r\n/);
  if (!m) return { reply: { error: 'nostatus' }, rest };
  const [head, body = ''] = text.split('\r\n\r\n');
  const headers = Object.fromEntries(head.split('\r\n').slice(1).map(l => l.split('=')).filter(p => p.length === 2));
  let json = null;
  if (body) { try { json = JSON.parse(body); } catch {} }
  return { reply: { seq: +m[1], status: +m[2], headers, json }, rest };
}

/** Texto de um comando "POST <nome> 1" com corpo JSON (protocolo antigo, o padrão do ZEUS CAST). */
function command(name, json) {
  if (name === 'conn') return 'POST conn\r\n\r\n';
  const body = JSON.stringify(json);
  return `POST ${name} 1\r\nContentType=json\r\nContentLength=${body.length}\r\n\r\n${body}`;
}

/** Pedaços de um quadro ao vivo em HID: cabeçalho de 24 bytes + até 1000 bytes do JPEG. */
function hidRealtimeChunks(jpeg, maxChunk = 1024) {
  const step = maxChunk - 24, count = Math.floor(jpeg.length / 1000) + 1, out = [];
  for (let off = 0, i = 0; off < jpeg.length; off += step, i++) {
    const n = Math.min(step, jpeg.length - off);
    const c = Buffer.alloc(n + 24);
    c[0] = 0x5C; c[1] = ((n + 21) >> 8) & 0xff; c[2] = (n + 21) & 0xff; c[3] = 1;
    c[4] = (count >> 8) & 0xff; c[5] = count & 0xff; c[6] = (i >> 8) & 0xff; c[7] = i & 0xff; c[8] = 1;
    jpeg.copy(c, 24, off, off + n);
    out.push(c);
  }
  return out;
}

/** Relatórios HID de 1025 bytes (report ID 0 + até 1024 bytes, completados com zero). */
function hidReports(data, reportSize = 1025) {
  const out = [];
  for (let off = 0; off < data.length; off += reportSize - 1) {
    const r = Buffer.alloc(reportSize);
    data.copy(r, 1, off, Math.min(data.length, off + reportSize - 1));
    out.push(r);
  }
  return out;
}

/**
 * Erro com causa conhecida, para a tela dizer o que fazer. code:
 * busy (porta aberta por outro programa), gone (sumiu), open (outra falha ao abrir), no-response (não respondeu),
 * protocol (respondeu algo inesperado), send (falha ao mandar imagem).
 */
class LcdError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- transportes ----------
const MAXDWORD = 0xFFFFFFFF;

/**
 * Porta COM pelo Windows (kernel32), sem módulo nativo extra: 115200 8N1. Leituras e escritas rodam numa thread
 * à parte (koffi .async); a porta não é "overlapped", então o Windows faz uma operação por vez — por isso nunca há
 * leitura pendente durante uma escrita (cada comando escreve e só depois lê a resposta).
 */
class SerialPortWin {
  constructor(name) { this.name = name; this.h = null; this.pending = Buffer.alloc(0); }
  static api() {
    if (SerialPortWin._api) return SerialPortWin._api;
    const koffi = require('koffi');
    const k = koffi.load('kernel32.dll');
    SerialPortWin._api = {
      CreateFileW: k.func('intptr __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *sec, uint32 disp, uint32 flags, void *tpl)'),
      GetLastError: k.func('uint32 __stdcall GetLastError()'),
      GetCommState: k.func('bool __stdcall GetCommState(intptr h, _Inout_ uint8_t *dcb)'),
      BuildCommDCBW: k.func('bool __stdcall BuildCommDCBW(str16 def, _Inout_ uint8_t *dcb)'),
      SetCommState: k.func('bool __stdcall SetCommState(intptr h, uint8_t *dcb)'),
      SetCommTimeouts: k.func('bool __stdcall SetCommTimeouts(intptr h, uint32_t *t)'),
      WriteFile: k.func('bool __stdcall WriteFile(intptr h, uint8_t *buf, uint32 n, _Out_ uint32_t *written, void *ov)'),
      ReadFile: k.func('bool __stdcall ReadFile(intptr h, _Out_ uint8_t *buf, uint32 n, _Out_ uint32_t *read, void *ov)'),
      CloseHandle: k.func('bool __stdcall CloseHandle(intptr h)')
    };
    return SerialPortWin._api;
  }
  open() {
    const a = SerialPortWin.api();
    // compartilhamento 0: porta COM no Windows é sempre exclusiva — se outro programa a abriu, dá erro 5
    const h = a.CreateFileW(`\\\\.\\${this.name}`, 0xC0000000, 0, null, 3, 0, null);
    if (!h || h === -1) {
      const err = a.GetLastError();
      if (err === 5) throw new LcdError('busy', tr('lcd.portBusy', { port: this.name }));
      if (err === 2) throw new LcdError('gone', tr('lcd.portGone', { port: this.name }));
      throw new LcdError('open', tr('lcd.portOpen', { port: this.name, code: err }));
    }
    const dcb = Buffer.alloc(28); dcb.writeUInt32LE(28, 0);
    a.GetCommState(h, dcb); a.BuildCommDCBW('baud=115200 parity=N data=8 stop=1', dcb); a.SetCommState(h, dcb);
    this.h = h;
    this.timeouts(0);
  }
  /** Leitura: devolve o que já chegou e espera até `waitMs` pelo primeiro byte. Escrita: no máximo 1 s por chamada. */
  timeouts(waitMs) {
    if (this.waitMs === waitMs) return;
    this.waitMs = waitMs;
    SerialPortWin.api().SetCommTimeouts(this.h, new Uint32Array(waitMs ? [MAXDWORD, MAXDWORD, waitMs, 0, 1000] : [MAXDWORD, 0, 0, 0, 1000]));
  }
  write(buf) {
    const a = SerialPortWin.api(), n = [0];
    return new Promise((resolve, reject) => a.WriteFile.async(this.h, buf, buf.length, n, null, (err, ok) =>
      err || !ok || n[0] !== buf.length ? reject(new LcdError('send', err?.message || tr('lcd.shortWrite', { done: n[0], total: buf.length }))) : resolve()));
  }
  read(waitMs) {
    this.timeouts(waitMs);
    const a = SerialPortWin.api(), b = Buffer.alloc(4096), n = [0];
    return new Promise(resolve => a.ReadFile.async(this.h, b, b.length, n, null, (err, ok) => resolve(err || !ok ? Buffer.alloc(0) : Buffer.from(b.subarray(0, n[0])))));
  }
  /** Espera uma resposta completa da tela por até `ms`. */
  async reply(ms) {
    for (const end = Date.now() + ms; ;) {
      const r = parseReply(this.pending);
      if (r) { this.pending = Buffer.from(r.rest); return r.reply; }
      const left = end - Date.now();
      if (left <= 0) return null;
      const chunk = await this.read(Math.min(100, left));
      if (chunk.length) this.pending = Buffer.concat([this.pending, chunk]);
    }
  }
  /** Descarta o que a tela mandou sem ninguém pedir (sem esperar). */
  async drain() { this.pending = Buffer.alloc(0); return this.read(0); }
  close() { if (this.h) { try { SerialPortWin.api().CloseHandle(this.h); } catch {} this.h = null; } }
}

/** Variante HID (sem cooler para testar aqui): escreve sem ler respostas, como o ZEUS CAST faz nesse caminho. */
class HidPort {
  constructor(path) { this.path = path; this.dev = null; }
  async open() {
    const HID = require('node-hid');
    try { this.dev = await HID.HIDAsync.open(this.path); }
    catch (e) { throw new LcdError('busy', tr('lcd.hidBusy', { error: e.message })); }
  }
  async write(buf) { await this.writeReports(hidReports(buf)); }
  async writeReports(reports) { try { for (const r of reports) await this.dev.write(r); } catch (e) { throw new LcdError('send', e.message); } }
  async reply() { return undefined; } // sem leitura: a confirmação "200" não existe neste caminho
  async drain() {}
  close() { try { this.dev?.close(); } catch {} this.dev = null; }
}

// ---------- detecção ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Identificadores USB das telas Gamdias. O mesmo modelo pode aparecer como porta serial (CDC: o AURA GL360 deste PC
 * é `1B80:B547`, interface MI_00 = COM) ou como HID, conforme a revisão do firmware — por isso os dois caminhos.
 */
const GAMDIAS_MODELS = {
  'VID_1B80&PID_B547': { name: 'Gamdias AURA GL360 LCD', width: 480, height: 480 },
  'VID_1B80&PID_B53D': { name: 'Gamdias CHIONE LCD', width: 480, height: 480 },
  'VID_1B80&PID_B53B': { name: 'Gamdias BOREAS LCD', width: 272, height: 480, untested: true },
  'VID_1D6B&PID_0111': { name: 'Gamdias LCD', width: 480, height: 480 }
};
const modelKey = (vid, pid) => `VID_${vid.toString(16).toUpperCase().padStart(4, '0')}&PID_${pid.toString(16).toUpperCase().padStart(4, '0')}`;

/** Portas COM ativas agora, de qualquer interface (MI_xx) dos modelos conhecidos. Três leituras do registro, sem PowerShell. */
async function gamdiasSerialPorts() {
  const active = (await reg(['HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'])).toUpperCase();
  if (!/REG_SZ\s+COM\d+/.test(active)) return [];
  const keys = (await reg(['HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB'])).split(/\r?\n/).map(l => l.trim())
    .filter(l => Object.keys(GAMDIAS_MODELS).some(k => l.toUpperCase().includes(`\\${k}`)));
  const found = [];
  for (const key of keys) {
    const model = Object.keys(GAMDIAS_MODELS).find(k => key.toUpperCase().includes(`\\${k}`));
    const out = await reg([key, '/s', '/v', 'PortName']);
    for (const m of out.matchAll(/PortName\s+REG_SZ\s+(COM\d+)/gi)) {
      const com = m[1].toUpperCase();
      if (new RegExp(`REG_SZ\\s+${com}\\b`).test(active) && !found.some(f => f.com === com)) found.push({ com, model });
    }
  }
  return found;
}

const gamdias = {
  id: 'gamdias',
  async detect() {
    const found = [];
    for (const { com, model } of await gamdiasSerialPorts()) found.push({ driver: 'gamdias', kind: 'serial', path: com, model, ...GAMDIAS_MODELS[model] });
    try {
      const HID = require('node-hid');
      for (const d of await HID.devicesAsync()) {
        const model = modelKey(d.vendorId, d.productId);
        if (GAMDIAS_MODELS[model] && !found.some(f => f.path === d.path)) found.push({ driver: 'gamdias', kind: 'hid', path: d.path, model, ...GAMDIAS_MODELS[model] });
      }
    } catch {}
    return found;
  },
  async open(info) {
    const port = info.kind === 'hid' ? new HidPort(info.path) : new SerialPortWin(info.path);
    await port.open();
    try {
      await port.drain();
      /** Manda um comando e confere a resposta "200" (no HID não há leitura: undefined). */
      const request = async (name, json, ms = 1500) => {
        await port.write(frame(command(name, json)));
        const r = await port.reply(ms);
        if (r === undefined) return null;
        if (r === null) throw new LcdError('no-response', tr('lcd.noAnswer', { command: name, port: info.path }));
        if (r.error) throw new LcdError('protocol', tr('lcd.badReply', { command: name, error: tr(`lcd.reply.${r.error}`) }));
        if (r.status !== 200) throw new LcdError('protocol', tr('lcd.refused', { command: name, code: r.status }));
        return r;
      };
      // mesma sequência do ZEUS CAST ao conectar, mais o modo de imagens ao vivo
      await request('power', { event: 'resume' });
      const hello = (await request('conn'))?.json || {};
      await request('timeout', { value: 0 });
      await request('realtimeDisplay', { enable: true });
      const v = hello.version || {};
      const device = {
        name: info.name, model: info.model, port: info.path, kind: info.kind, width: info.width, height: info.height, untested: !!info.untested,
        firmware: v.firmware || null, hardware: v.hardware || null, app: v.app || null
      };
      const conn = {
        info, device,
        setBrightness: v => request('brightness', { value: Math.max(0, Math.min(100, Math.round(v))) }),
        async sendFrame(jpeg) {
          if (info.kind === 'hid') return port.writeReports(hidRealtimeChunks(jpeg).flatMap(c => hidReports(c)));
          for (let off = 0; off < jpeg.length; off += 1024) await port.write(jpeg.subarray(off, off + 1024));
          // o que a tela devolveu desde o último quadro (nada pode acumular na porta): "200" é a confirmação de
          // recebimento; outro código vira erro de protocolo
          for (let buf = await port.drain(), r; (r = parseReply(buf)); buf = r.rest) {
            if (r.reply.status !== 200) throw new LcdError('protocol', tr('lcd.imageRefused', { reason: r.reply.error ? tr(`lcd.reply.${r.reply.error}`) : r.reply.status }));
          }
        },
        close: async () => { try { await request('realtimeDisplay', { enable: false }, 500); } catch {} port.close(); }
      };
      return conn;
    } catch (e) { port.close(); throw e; }
  }
};

const DRIVERS = [gamdias];

/**
 * Cooler não encontrado por nenhum driver: o que o Windows mostra do USB. Aparelho com problema (ou o "dispositivo
 * desconhecido" VID_0000&PID_0001 de quando o descritor USB falha) → usb-error; aparece mas sem porta serial nem HID
 * de um modelo conhecido (revisão nova de hardware?) → incompatible; nada → missing.
 */
async function diagnoseUsb() {
  const ids = ['USB\\VID_0000&PID_0001*', 'USB\\VID_1B80*', ...Object.keys(GAMDIAS_MODELS).map(k => `USB\\${k}*`)];
  const match = ids.map(id => `$_.InstanceId -like ${psQuote(id)}`).join(' -or ');
  const out = await powershell(`Get-PnpDevice -PresentOnly | Where-Object { ${match} } | ForEach-Object { "$($_.Status)|$($_.FriendlyName)|$($_.InstanceId)" }`);
  const devices = out.out.split(/\r?\n/).filter(Boolean).map(l => { const [status, name, id] = l.split('|'); return { status, name, id }; });
  const broken = devices.find(d => d.status !== 'OK');
  if (broken) return { state: 'usb-error', device: { name: broken.name, port: broken.id } };
  const known = devices.find(d => /VID_1B80/i.test(d.id)); // 1D6B é um VID genérico: sozinho não diz que é a Gamdias
  if (known) return { state: 'incompatible', device: { name: known.name, port: known.id } };
  return { state: 'missing' };
}

/**
 * Serviço usado pelo processo principal: conecta sozinho, manda quadros, avisa o estado.
 * state = { connected, device, error: { code, message } | null }.
 */
class CoolerLcd {
  constructor({ onState, brightness = 100 }) { this.onState = onState; this.conn = null; this.busy = false; this.state = { connected: false, device: null, error: null }; this.brightness = brightness; this.retryAfter = 0; this.misses = 0; }
  setState(p) { this.state = { ...this.state, ...p }; this.onState?.(this.state); }

  /**
   * Situação para a tela Watercooler, tentando conectar de verdade. state: connected | disabled (achado, envio
   * desligado — a porta nem é aberta, para não tirar a tela do modo dela) | busy | gone | open | no-response |
   * protocol | send (achado, mas algo falhou) | usb-error | incompatible | missing (o que o Windows mostra do USB).
   */
  async status({ enabled }) {
    if (!enabled) {
      const [info] = await this.detectAll();
      if (info) return { state: 'disabled', device: { name: info.name, port: info.path, kind: info.kind, width: info.width, height: info.height } };
    }
    const conn = await this.ensure(true);
    if (conn) return { state: 'connected', device: conn.device };
    const err = this.state.error;
    if (err && err.code !== 'missing') return { state: err.code, device: this.state.device, error: err.message };
    return diagnoseUsb();
  }
  async detectAll() { const all = []; for (const d of DRIVERS) all.push(...await d.detect().catch(() => [])); return all; }
  async ensure(force = false) {
    if (this.conn) return this.conn;
    if (this.connecting) return this.connecting;
    // sem cooler: procura de novo só depois de `retryAfter` — 15 s, dobrando a cada busca vazia até 2 min (cada busca
    // abre o registro do Windows e lista o USB; o app fica ligado o dia todo), e 3 s depois de uma queda
    if (!force && Date.now() < this.retryAfter) return null;
    this.retryAfter = Date.now() + Math.min(120000, 15000 * 2 ** this.misses);
    this.connecting = (async () => {
      try {
        const found = await this.detectAll();
        if (!found.length) { this.misses = Math.min(this.misses + 1, 3); this.setState({ connected: false, device: null, error: { code: 'missing', message: null } }); return null; }
        this.misses = 0;
        let lastError = null;
        for (const info of found) { // mais de uma porta/caminho: usa o primeiro que conversar
          try {
            this.conn = await DRIVERS.find(d => d.id === info.driver).open(info);
            await this.conn.setBrightness(this.brightness);
            this.setState({ connected: true, device: this.conn.device, error: null });
            return this.conn;
          } catch (e) { this.conn = null; lastError = e; }
        }
        this.setState({ connected: false, device: { name: found[0].name, port: found[0].path, kind: found[0].kind }, error: { code: lastError.code || 'open', message: lastError.message } });
        return null;
      } finally { this.connecting = null; }
    })();
    return this.connecting;
  }
  /** Um quadro JPEG do tamanho da tela. Devolve false só se não há cooler; quadro que chega com o anterior ainda indo é descartado. */
  async frame(jpeg) {
    if (this.busy) return true;
    this.busy = true;
    try {
      const c = await this.ensure();
      if (!c) return false;
      await c.sendFrame(Buffer.from(jpeg));
      return true;
    } catch (e) {
      this.setState({ connected: false, error: { code: 'send', message: tr('lcd.stopped', { error: e.message }) } });
      await this.close(false);
      this.retryAfter = Date.now() + 3000; // cabo mexido ou cooler reiniciado: tenta logo de novo
      return false;
    } finally { this.busy = false; }
  }
  async setBrightness(v) { this.brightness = v; try { await this.conn?.setBrightness(v); } catch {} }
  async close(report = true) { const c = this.conn; this.conn = null; try { await c?.close(); } catch {} if (report) this.setState({ connected: false }); }
}

module.exports = { CoolerLcd, setTranslator, frame, parseReply, command, hidRealtimeChunks, hidReports };
