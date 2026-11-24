'use strict';
// Acesso ao driver PawnIO (assinado) diretamente por DeviceIoControl, sem bibliotecas de terceiros.
// Interface do driver (PawnIO, GPL-2.0 com exceção para programas que usam apenas o IOCTL):
//   dispositivo  \\?\GLOBALROOT\Device\PawnIO
//   LOAD_BINARY  = (41394 << 16) | (0x821 << 2)   entrada: blob do módulo assinado
//   EXECUTE      = (41394 << 16) | (0x841 << 2)   entrada: nome da função (32 bytes ASCII) + valores int64; saída: int64[]
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');
const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
const CreateFileW = k32.func('__stdcall', 'CreateFileW', HANDLE, ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'void *']);
const DeviceIoControl = k32.func('__stdcall', 'DeviceIoControl', 'bool', [HANDLE, 'uint32', 'void *', 'uint32', 'void *', 'uint32', koffi.out(koffi.pointer('uint32')), 'void *']);
const CloseHandle = k32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]);
const GetLastError = k32.func('__stdcall', 'GetLastError', 'uint32', []);
const CreateMutexW = k32.func('__stdcall', 'CreateMutexW', HANDLE, ['void *', 'bool', 'str16']);
const WaitForSingleObject = k32.func('__stdcall', 'WaitForSingleObject', 'uint32', [HANDLE, 'uint32']);
const ReleaseMutex = k32.func('__stdcall', 'ReleaseMutex', 'bool', [HANDLE]);

const GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, OPEN_EXISTING = 3;
const DEVICE_TYPE = (41394 << 16) >>> 0;
const IOCTL_LOAD = (DEVICE_TYPE | (0x821 << 2)) >>> 0;
const IOCTL_EXECUTE = (DEVICE_TYPE | (0x841 << 2)) >>> 0;
const NAME_LEN = 32;

function invalid(h) {
  if (!h) return true;
  const a = koffi.address(h);
  return a === 0n || a === 0xFFFFFFFFFFFFFFFFn;
}

class PawnIO {
  constructor() { this.h = null; }

  open() {
    this.h = CreateFileW('\\\\?\\GLOBALROOT\\Device\\PawnIO', (GENERIC_READ | GENERIC_WRITE) >>> 0, 0, null, OPEN_EXISTING, 0, null);
    if (invalid(this.h)) {
      const err = GetLastError();
      this.h = null;
      // i18n: chave do texto para a interface (o auxiliar traduz); a mensagem fica técnica, para o log
      const key = err === 2 || err === 3 ? 'ram.driverMissing' : err === 5 ? 'ram.driverDenied' : 'ram.driverOpen';
      throw Object.assign(new Error(`PawnIO open failed (Win32 error ${err})`), { code: err, i18n: { key, vars: { code: err } } });
    }
  }

  load(blob) {
    const out = [0];
    if (!DeviceIoControl(this.h, IOCTL_LOAD, blob, blob.length, null, 0, out, null)) {
      const code = GetLastError();
      throw Object.assign(new Error(`module refused by the driver (Win32 error ${code})`), { i18n: { key: 'ram.moduleRefused', vars: { code } } });
    }
  }

  /** Executa uma função do módulo. inputs: array de BigInt/number. Retorna BigInt[] */
  execute(name, inputs = [], outCount = 0) {
    const inBuf = Buffer.alloc(NAME_LEN + inputs.length * 8);
    inBuf.write(name, 0, NAME_LEN - 1, 'ascii');
    inputs.forEach((v, i) => inBuf.writeBigInt64LE(BigInt.asIntN(64, BigInt(v)), NAME_LEN + i * 8));
    const outBuf = Buffer.alloc(Math.max(8, outCount * 8));
    const ret = [0];
    if (!DeviceIoControl(this.h, IOCTL_EXECUTE, inBuf, inBuf.length, outBuf, outCount * 8, ret, null)) {
      const e = new Error(`${name} falhou (erro ${GetLastError()})`);
      e.code = 'EXEC';
      throw e;
    }
    const n = Math.floor(ret[0] / 8);
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(outBuf.readBigInt64LE(i * 8));
    return vals;
  }

  close() { if (this.h) { CloseHandle(this.h); this.h = null; } }
}

/** Mutex global usado por firmware e outros programas para compartilhar o SMBus com segurança. */
class SmbusMutex {
  constructor() { this.h = CreateMutexW(null, false, 'Global\\Access_SMBUS.HTP.Method'); }
  lock(ms = 200) {
    if (invalid(this.h)) return true;
    const r = WaitForSingleObject(this.h, ms);
    return r === 0 || r === 0x80; // obtido ou abandonado
  }
  unlock() { if (!invalid(this.h)) ReleaseMutex(this.h); }
}

module.exports = { PawnIO, SmbusMutex };
