'use strict';
// Processo auxiliar do Hydraflow para RGB de memória (roda com privilégio de administrador).
// Expõe um pipe local com operações RESTRITAS: detectar memórias e enviar cores para as já detectadas.
// Não há comando genérico de leitura/escrita no SMBus.
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SmbusBus } = require('./bus');
const dram = require('./corsairDram');
const { taskName, helperPaths } = require('./protocol');
const { schtasks } = require('../common/winsys');
const { createI18n, langFromConfig } = require('../common/i18n');

const IDLE_EXIT_MS = 90 * 1000;

const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Tarefa sob demanda com privilégio elevado: o app inicia o auxiliar depois sem pedir permissão de novo.
 * Registrada por XML (o mesmo que o Agendador gera) com o usuário pelo SID: os cmdlets New-ScheduledTask* às vezes
 * falhavam com "The parameter is incorrect" (visto no memoria.log) e o nome do usuário pode ser ambíguo.
 */
// Registro pelo schtasks.exe com o XML num arquivo (UTF-16). Antes era o Register-ScheduledTask do PowerShell (CIM):
// em alguns Windows ele responde "The parameter is incorrect" no meio do registro e deixa a tarefa num estado em que
// o próprio usuário não consegue iniciá-la (status "N/A") — a RAM pedia permissão de novo e não voltava após o boot.
async function registerTask(exe, args, log) {
  const sid = (() => { try { return require('child_process').execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }).toString().split(',').pop().replace(/["\r\n]/g, ''); } catch { return null; } })();
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Hydraflow: controle de RGB das memorias (${xmlEscape(exe)})</Description></RegistrationInfo>
  <Principals><Principal id="Author">${sid ? `<UserId>${sid}</UserId>` : ''}<LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(exe)}</Command><Arguments>${xmlEscape(args)}</Arguments></Exec></Actions>
</Task>`;
  const file = path.join(require('os').tmpdir(), `hydraflow-task-${process.pid}.xml`);
  try {
    fs.writeFileSync(file, '﻿' + xml, 'utf16le');
    const name = taskName(exe);
    await schtasks(['/Delete', '/TN', name, '/F']); // tarefa velha (talvez no estado quebrado do CIM): fora
    const r = await schtasks(['/Create', '/TN', name, '/XML', file, '/F']);
    log(r.ok ? `Tarefa de inicialização registrada (${name})` : 'Falha ao registrar tarefa: ' + (r.err || r.out));
  } finally { try { fs.rmSync(file, { force: true }); } catch {} }
}

/** Instala o driver PawnIO em silêncio (instalador oficial que vem dentro do app), se ainda não estiver. */
function installDriver(setup, log) {
  try {
    const r = require('child_process').spawnSync(setup, ['-install', '-silent'], { windowsHide: true, timeout: 5 * 60000 });
    log(`Driver PawnIO: instalador terminou com código ${r.status}${r.status === 3010 ? ' (pede reinício)' : ''}`);
    return r.status === 0 || r.status === 3010;
  } catch (e) { log('Driver PawnIO: ' + e.message); return false; }
}

function runHelper({ dataDir, exe, taskArgs, register, installDriver: setup }) {
  const { modulesDir, logFile, connFile } = helperPaths(dataDir);
  const token = crypto.randomBytes(24).toString('hex');
  const log = msg => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {} };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  log('Auxiliar de memória iniciando');
  // mesma permissão do UAC: driver (se o app pediu) e a tarefa para as próximas vezes, antes de abrir o barramento
  if (setup && fs.existsSync(setup)) installDriver(setup, log);
  if (register && exe) registerTask(exe, taskArgs, log);

  const bus = new SmbusBus();
  let dimms = [];
  let busError = null;
  try {
    const kind = bus.open(modulesDir);
    log(`SMBus aberto (${kind})`);
    dimms = dram.detect(bus, log);
  } catch (e) {
    // o erro vai para a interface no idioma escolhido no app (lido do config.json ao iniciar)
    busError = e.i18n ? createI18n(langFromConfig(dataDir)).t(e.i18n.key, e.i18n.vars) : e.message;
    log('Erro: ' + e.message);
  }

  const clients = new Set();
  let idleTimer = null;
  const armIdle = () => { clearTimeout(idleTimer); if (!clients.size) idleTimer = setTimeout(() => { log('Sem clientes, encerrando'); process.exit(0); }, IDLE_EXIT_MS); };

  const server = net.createServer(sock => {
    let authed = false;
    let buf = '';
    const reply = obj => { try { sock.write(JSON.stringify(obj) + '\n'); } catch {} };
    const hello = () => reply({ type: 'hello', bus: bus.kind, error: busError, dimms: dimms.map(({ addr, name, leds, firmware, pid }) => ({ addr, name, leds, firmware, pid })) });
    const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, 3000);
    sock.on('data', d => {
      buf += d.toString('utf8');
      if (buf.length > 1e6) { sock.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (!authed) {
          if (msg.cmd === 'auth' && typeof msg.token === 'string' && msg.token.length === token.length &&
              crypto.timingSafeEqual(Buffer.from(msg.token), Buffer.from(token))) {
            authed = true; clearTimeout(authTimer); clients.add(sock); clearTimeout(idleTimer); hello();
          } else { sock.destroy(); return; }
          continue;
        }
        if (msg.cmd === 'colors') {
          const dimm = dimms.find(x => x.addr === msg.addr);
          if (!dimm || !Array.isArray(msg.rgb)) continue;
          try { dram.setColors(bus, dimm, msg.rgb.slice(0, dimm.leds * 3).map(v => Math.max(0, Math.min(255, v | 0)))); }
          catch (e) { reply({ type: 'error', addr: dimm.addr, error: e.message }); }
        } else if (msg.cmd === 'detect') {
          if (bus.dev) { try { dimms = dram.detect(bus, log); } catch (e) { busError = e.message; } }
          hello();
        }
      }
    });
    sock.on('close', () => { clients.delete(sock); armIdle(); });
    sock.on('error', () => {});
  });
  server.on('error', e => { log('Servidor indisponível: ' + e.message); process.exit(1); });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    fs.writeFileSync(connFile, JSON.stringify({ port, token, pid: process.pid, started: Date.now() }));
    log(`Aguardando o Hydraflow na porta local ${port}`);
  });
  process.on('exit', () => { try { const c = JSON.parse(fs.readFileSync(connFile, 'utf8')); if (c.pid === process.pid) fs.rmSync(connFile, { force: true }); } catch {} });
  armIdle();
}

module.exports = { runHelper, registerTask };
