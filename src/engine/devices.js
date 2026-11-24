'use strict';
// Peças comuns aos provedores de dispositivos (src/engine/providers/*). Cada provedor é um objeto com:
//   name                       nome do provedor ('plugin', 'ram', 'wled', 'gpu')
// Ordem no início do motor (engine.js, comando init): announce() → configure(payload) → start() → laços de render e poll.
//   announce()                 manda o status inicial do provedor à janela
//   start()                    primeira detecção (placas de vídeo); os plugins aparecem pelo configure(pluginFolders)
//   configure(payload)         ajustes vindos do app (init e 'config'); cada um lê só a própria chave
//   poll()                     a cada 5 s: reconectar / procurar aparelhos novos
//   rescan()                   o usuário pediu para procurar de novo (e na volta da suspensão)
//   render(now)                manda ao hardware os quadros novos (rt.fresh) dos seus dispositivos
//   publish(rt)                { plugin, endpoint, descriptor } para a janela
//   setEnabled(rt, on), reload(rt)
//   hardwareSave(rt)           { supported, modes } ou { supported: false, reason }  ("Salvar no dispositivo")
//   save(rt, mode)             grava no hardware → { ok, detail?, error?, params? }
//   relabel()                  idioma trocado: nomes publicados mudam junto
//   shutdown(opts)
//   setParam(rt, name, value), pulse(rt, channels, ms)   só onde existe (plugins)
//   log(rt, level, msg)        guarda a linha no log próprio do provedor (plugins); sem ele, o motor guarda
//   redetect()                 procura de novo os pentes de RAM (só o provedor ram)
// Tudo é opcional menos name, render, publish e setEnabled.

/** Trecho de id de dispositivo. As ids viram caminhos do store ("devices.<id>"), que usa "." como separador. */
const safeId = s => String(s).replace(/[.\s]/g, '_');

/** Id de dispositivo: "<tipo>:<partes>", cada parte já segura para o store (ex.: o IP de uma fita WLED). */
const deviceId = (kind, ...parts) => [kind, ...parts.map(safeId)].join(':');

/** Descritor de um dispositivo de uma linha só (pente de RAM, fita, zonas de placa de vídeo). */
function lineDescriptor({ name, ledNames, vertical = false, deviceType, publisher, scale }) {
  const n = ledNames.length;
  return {
    name, size: vertical ? [1, n] : [n, 1], ledNames,
    // em pé (pente de memória): o LED 1 fica embaixo
    ledPositions: ledNames.map((_, k) => (vertical ? [0, n - 1 - k] : [k, 0])),
    image: '', deviceType, publisher, defaultPosition: null, defaultScale: scale,
    subdevices: [], channels: [], parameters: [], frameRate: 30
  };
}
const ledNames = n => Array.from({ length: n }, (_, k) => `LED ${k + 1}`);

/** Cores de cada LED a partir do quadro (w×h, RGB): [[r,g,b], …] na ordem de positions. */
function sampleLeds(frame, positions) {
  if (!frame) return [];
  return positions.map(([x, y]) => { const i = (y * frame.w + x) * 3; return [frame.data[i] || 0, frame.data[i + 1] || 0, frame.data[i + 2] || 0]; });
}

/** Limita um envio a ~30 Hz (SMBus e placas de vídeo não precisam de mais). */
function rateLimit(ms = 33) {
  let last = 0;
  return now => { if (now - last < ms) return false; last = now; return true; };
}

/** "Só manda quando muda": guarda a última chave enviada por dispositivo. */
function changeTracker() {
  const sent = new Map();
  return {
    changed(id, colors) { const key = colors.join(';'); if (sent.get(id) === key) return false; sent.set(id, key); return true; },
    forget(id) { if (id === undefined) sent.clear(); else sent.delete(id); }
  };
}

/** Status de conexão que só vai à janela quando muda (a reconexão a cada 5 s repetiria o mesmo erro). */
function statusHolder(send, type, initial) {
  let cur = initial;
  return {
    get: () => cur,
    set(patch) {
      if (!Object.keys(patch).some(k => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]))) return;
      cur = { ...cur, ...patch };
      send(type, cur);
    },
    announce() { send(type, cur); }
  };
}

module.exports = { safeId, deviceId, lineDescriptor, ledNames, sampleLeds, rateLimit, changeTracker, statusHolder };
