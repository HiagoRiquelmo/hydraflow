'use strict';
// Pausa síncrona sem ocupar a CPU: plugins e o protocolo SMBus esperam no meio de uma sequência de E/S.
const cell = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) { if (ms > 0) Atomics.wait(cell, 0, 0, Math.min(ms, 5000)); }

module.exports = { sleepSync };
