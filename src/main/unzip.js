'use strict';
// Leitor ZIP mínimo (diretório central + deflate), sem dependências.
const zlib = require('zlib');

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  // mensagens técnicas em inglês: quem chama (ramSupport) as embrulha numa mensagem traduzida
  if (eocd < 0) throw new Error('invalid ZIP (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupted ZIP');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({
      name,
      read() {
        const lnl = buf.readUInt16LE(local + 26), lel = buf.readUInt16LE(local + 28);
        const start = local + 30 + lnl + lel;
        const data = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error('unsupported ZIP compression: ' + method);
      }
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

module.exports = { readZip };
