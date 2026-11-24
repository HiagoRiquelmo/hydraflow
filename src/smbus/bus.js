'use strict';
// Barramento SMBus através de um módulo PawnIO oficial (AMD PIIX4/FCH ou Intel I801).
// Função do módulo: ioctl_smbus_xfer(in[0]=endereço, in[1]=0 escrita|1 leitura, in[2]=comando, in[3]=protocolo, in[4..8]=dados)
const fs = require('fs');
const path = require('path');
const { PawnIO, SmbusMutex } = require('./pawnio');

const PROTO = { BYTE_DATA: 2, BLOCK_DATA: 5 }; // os dois que o controlador de LED das memórias usa
const WRITE = 0, READ = 1;

class SmbusBus {
  constructor() { this.dev = null; this.kind = null; this.mutex = new SmbusMutex(); }

  /** Abre o driver e carrega o primeiro módulo compatível com o chipset. */
  open(modulesDir) {
    const candidates = [['PIIX4', 'SmbusPIIX4.bin'], ['I801', 'SmbusI801.bin']];
    const errors = [];
    for (const [kind, file] of candidates) {
      const p = path.join(modulesDir, file);
      if (!fs.existsSync(p)) { errors.push(`${file} missing`); continue; }
      const dev = new PawnIO();
      try {
        dev.open();
        dev.load(fs.readFileSync(p));
        this.dev = dev;
        this.kind = kind;
        this.selectPort(0); // AMD: memórias ficam na porta principal do FCH (a Intel não tem portas)
        return kind;
      } catch (e) {
        dev.close();
        if ([2, 3, 5].includes(e.code)) throw e; // driver ausente ou sem permissão: não adianta tentar o próximo módulo
        errors.push(`${kind}: ${e.message}`);
      }
    }
    const details = errors.join('; ');
    throw Object.assign(new Error('no compatible SMBus controller: ' + details), { i18n: { key: 'ram.noSmbus', vars: { details } } });
  }

  selectPort(port) {
    if (this.kind !== 'PIIX4') return;
    this.locked(() => this.dev.execute('ioctl_piix4_port_sel', [port], 1));
  }

  locked(fn) {
    if (!this.mutex.lock(500)) throw new Error('SMBus ocupado por outro programa');
    try { return fn(); } finally { this.mutex.unlock(); }
  }

  xfer(addr, rw, cmd, proto, data = []) {
    const input = [addr, rw, cmd, proto, ...data];
    while (input.length < 9) input.push(0);
    return this.dev.execute('ioctl_smbus_xfer', input, 5);
  }

  readByteData(addr, reg) {
    try { return Number(this.locked(() => this.xfer(addr, READ, reg, PROTO.BYTE_DATA))[0] & 0xFFn); }
    catch { return -1; }
  }

  writeByteData(addr, reg, value) {
    this.locked(() => this.xfer(addr, WRITE, reg, PROTO.BYTE_DATA, [value & 0xFF]));
  }

  /** Escrita em bloco SMBus (1..32 bytes). Os bytes são empacotados em células de 64 bits: [tamanho, dados...] */
  writeBlockData(addr, reg, bytes) {
    if (bytes.length < 1 || bytes.length > 32) throw new Error('Bloco SMBus deve ter 1 a 32 bytes');
    const packed = Buffer.alloc(40);
    packed[0] = bytes.length;
    for (let i = 0; i < bytes.length; i++) packed[1 + i] = bytes[i] & 0xFF;
    const cells = [];
    for (let i = 0; i < 5; i++) cells.push(packed.readBigUInt64LE(i * 8));
    this.locked(() => this.xfer(addr, WRITE, reg, PROTO.BLOCK_DATA, cells));
  }
}

module.exports = { SmbusBus };
