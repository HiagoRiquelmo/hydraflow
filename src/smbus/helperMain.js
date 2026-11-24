'use strict';
// Ponto de entrada do auxiliar de memória em modo Node puro (ELECTRON_RUN_AS_NODE=1):
// sem Chromium, sem processo de GPU — só o necessário para falar com o SMBus.
const { runHelper } = require('./helper');

const arg = name => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

let opts = {};
try { opts = JSON.parse(Buffer.from(arg('opts') || '', 'base64').toString('utf8') || '{}'); } catch {}

runHelper({ dataDir: arg('data-dir'), exe: opts.exe, taskArgs: opts.taskArgs, register: !!opts.register, installDriver: opts.installDriver || null });
