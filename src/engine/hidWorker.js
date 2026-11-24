'use strict';
// Thread de escrita HID de UM dispositivo (worker_threads dentro do motor).
// As escritas do Render() de um plugin são síncronas e algumas controladoras levam dezenas de ms por quadro (a ASUS
// Aura ~45 ms): feitas na thread do motor, um dispositivo esperava o outro. Aqui cada dispositivo escreve sozinho.
// - "Mais recente vence": se chegam vários quadros enquanto um está sendo escrito, só o último é escrito depois.
// - busy[0] = 1 enquanto há quadro pendente ou em escrita (o motor marca antes de mandar; esta thread zera no fim).
//   O motor espera por ele antes de qualquer escrita síncrona (desligar, ajustes), para a ordem não se inverter.
const { parentPort, workerData } = require('worker_threads');
const HID = require('node-hid');

const busy = new Int32Array(workerData.busy);
const handles = new Map();
const handle = path => { let h = handles.get(path); if (!h) { h = new HID.HID(path); handles.set(path, h); } return h; };

let pending = null, scheduled = false;

function run() {
  scheduled = false;
  while (pending) {
    const b = pending; pending = null;
    let error = null;
    try { const dev = handle(b.path); for (const buf of b.bufs) dev.write(buf); }
    catch (e) { error = e.message; handles.get(b.path)?.close?.(); handles.delete(b.path); } // reabre no próximo
    parentPort.postMessage({ type: 'done', error });
  }
  Atomics.store(busy, 0, 0);
  Atomics.notify(busy, 0);
}

parentPort.on('message', m => {
  if (m.type === 'batch') {
    pending = m; // um quadro novo substitui o que ainda não começou
    // setImmediate: deixa chegar as outras mensagens na fila antes, para escrever só a mais recente
    if (!scheduled) { scheduled = true; setImmediate(run); }
  } else if (m.type === 'close') {
    for (const h of handles.values()) { try { h.close(); } catch {} }
    handles.clear();
    Atomics.store(busy, 0, 0); Atomics.notify(busy, 0);
    process.exit(0);
  }
});
