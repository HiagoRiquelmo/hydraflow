'use strict';
// Contrato entre o app e o auxiliar de memória: onde ficam os arquivos, o nome da tarefa agendada
// e o protocolo do soquete local (uma linha JSON por mensagem; a primeira precisa ser { cmd: 'auth', token }).
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

// Nome antigo (uma tarefa só para qualquer executável): a versão de desenvolvimento e a instalada usam a mesma pasta
// de dados e brigavam por ela — cada troca invalidava a permissão e o painel voltava a pedir "Ativar".
const LEGACY_TASK = 'HydraflowMemoriaRGB';
/** Tarefa agendada do auxiliar para um executável: cada instalação tem a sua (uma confirmação do Windows por executável). */
const taskName = exe => `${LEGACY_TASK}-${crypto.createHash('sha1').update(path.resolve(String(exe)).toLowerCase()).digest('hex').slice(0, 8)}`;

function helperPaths(dataDir) {
  return {
    modulesDir: path.join(dataDir, 'pawnio', 'modules'),
    logFile: path.join(dataDir, 'logs', 'memoria.log'),
    connFile: path.join(dataDir, 'smbus.json')
  };
}

// Linha de comando do auxiliar: o app relança o próprio executável com estes argumentos (elevado ou pela tarefa agendada).
const HELPER_FLAG = '--smbus-helper';

/** appArgs: argumentos que o executável precisa antes dos nossos (em desenvolvimento, a pasta do app). */
/** installDriver: caminho do instalador oficial do PawnIO, para o auxiliar elevado instalar antes (mesmo UAC). */
function helperArgs(appArgs, dataDir, register, installDriver = null) {
  return [...appArgs, HELPER_FLAG, `--data-dir=${dataDir}`, ...(register ? ['--register-task'] : []), ...(installDriver ? [`--install-driver=${installDriver}`] : [])];
}

/** null se este processo não foi aberto como auxiliar. taskArgs: a mesma linha, para a tarefa agendada repetir. */
function parseHelperArgs(argv, fallbackDataDir) {
  if (!argv.includes(HELPER_FLAG)) return null;
  const val = name => { const a = argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const once = a => a === '--register-task' || a.startsWith('--install-driver='); // só na ativação, não na tarefa
  return {
    dataDir: val('data-dir') || fallbackDataDir,
    register: argv.includes('--register-task'),
    installDriver: val('install-driver'),
    taskArgs: argv.slice(1).filter(a => !once(a)).map(a => `"${a}"`).join(' ')
  };
}

function readConnInfo(connFile) {
  try { return JSON.parse(fs.readFileSync(connFile, 'utf8')); } catch { return null; }
}

/** Conecta ao auxiliar já autenticado. Devolve null se ele não estiver rodando. */
function connectHelper(connFile, { onMessage, onClose } = {}) {
  const info = readConnInfo(connFile);
  if (!info) return null;
  const sock = net.connect(info.port, '127.0.0.1');
  const write = obj => { try { sock.write(JSON.stringify(obj) + '\n'); } catch {} };
  let up = false; // nada pode chegar antes do auth: o auxiliar derruba a conexão
  const send = obj => { if (up) write(obj); };
  let buf = '';
  sock.setNoDelay(true);
  sock.on('connect', () => { up = true; write({ cmd: 'auth', token: info.token }); });
  sock.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      onMessage?.(m);
    }
  });
  sock.on('close', () => onClose?.());
  sock.on('error', () => {});
  return { send, close: () => sock.destroy() };
}

/**
 * O auxiliar está mesmo de pé? Conecta, autentica e espera o "hello". Olhar só o PID do arquivo de conexão engana:
 * o arquivo sobra quando o auxiliar morre sem limpar (PC desligado) e o Windows reaproveita o número do processo.
 */
function probeHelper(connFile, ms = 1500) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(t); client?.close(); resolve(ok); };
    const client = connectHelper(connFile, { onMessage: m => { if (m.type === 'hello') finish(true); }, onClose: () => finish(false) });
    const t = setTimeout(() => finish(false), ms);
    if (!client) finish(false);
  });
}

module.exports = { LEGACY_TASK, taskName, helperPaths, helperArgs, parseHelperArgs, readConnInfo, connectHelper, probeHelper };
