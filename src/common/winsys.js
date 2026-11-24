'use strict';
// Consultas ao Windows. Rápidas, sem PowerShell (cada PowerShell custava 200–700 ms e um núcleo de CPU; a tela de
// Dispositivos chegava a esperar 1 s por três deles): registro pelo reg.exe, processos pela API, tarefas agendadas
// pelo schtasks. PowerShell só para o que não tem outro caminho (pedir elevação, registrar tarefa, estado do USB).
// Nada aqui lança erro.
const { execFile } = require('child_process');

const run = (exe, args, timeout = 5000) => new Promise(resolve =>
  execFile(exe, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (e, out) => resolve(e ? '' : String(out))));

/** Devolve { ok, out, err }. */
function powershell(cmd, { timeout = 60000 } = {}) {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout },
    (err, out, errOut) => resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || err?.message || '').trim() })));
}
const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Abre um programa com permissão de administrador (o Windows mostra a confirmação do UAC) direto pela API
 * (ShellExecuteW "runas"), sem PowerShell no meio — o PowerShell elevado aparecia como uma janela de terminal
 * piscando (visto na instalação). Não espera o programa terminar. Devolve { ok, error? }; error 'cancelled' quando
 * a pessoa recusa.
 */
let shell32 = null;
function elevate(exe, args = []) {
  try {
    if (!shell32) {
      const koffi = require('koffi');
      const lib = koffi.load('shell32.dll');
      shell32 = lib.func('intptr __stdcall ShellExecuteW(void *hwnd, str16 verb, str16 file, str16 params, str16 dir, int show)');
    }
    const params = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    const r = Number(shell32(null, 'runas', exe, params, null, 0)); // 0 = SW_HIDE (o auxiliar não tem janela)
    if (r > 32) return { ok: true };
    return { ok: false, error: r === 5 ? 'cancelled' : `ShellExecute ${r}` }; // 5 = acesso negado (UAC recusado)
  } catch (e) { return { ok: false, error: e.message }; }
}

/** schtasks.exe direto (sem o módulo ScheduledTasks/CIM do PowerShell, que em alguns Windows responde
 *  "The parameter is incorrect" e deixa a tarefa num estado que o próprio usuário não consegue iniciar). */
function schtasks(args, timeout = 15000) {
  return new Promise(resolve => execFile('schtasks.exe', args, { windowsHide: true, timeout },
    (err, out, errOut) => resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || err?.message || '').trim() })));
}

/** Saída crua de "reg query" (vazia se a chave não existir). */
const regQuery = args => run('reg.exe', ['query', ...args]);

/** Um valor do registro (REG_SZ/REG_DWORD…) como texto, ou null. */
async function regValue(key, name) {
  const out = await regQuery([key, '/v', name]);
  const m = out.match(new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_\\w+\\s+(.*)$`, 'mi'));
  return m ? m[1].trim() : null;
}

// Lista de processos direto do Windows (CreateToolhelp32Snapshot, ~1 ms) — o tasklist levava ~300 ms. Se o koffi
// não estiver disponível, cai para o tasklist. Compartilhada por quem pergunta ao mesmo tempo, no máximo uma a cada 2 s.
let snap = null;
function snapshotNames() {
  if (snap === false) return null;
  try {
    if (!snap) {
      const koffi = require('koffi');
      const k = koffi.load('kernel32.dll');
      snap = {
        create: k.func('intptr __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
        first: k.func('bool __stdcall Process32FirstW(intptr h, _Inout_ uint8_t *entry)'),
        next: k.func('bool __stdcall Process32NextW(intptr h, _Inout_ uint8_t *entry)'),
        close: k.func('bool __stdcall CloseHandle(intptr h)')
      };
    }
    const h = snap.create(0x2, 0); // TH32CS_SNAPPROCESS
    if (!h || h === -1) return null;
    const SIZE = 568, entry = Buffer.alloc(SIZE), names = new Set(); // PROCESSENTRY32W (x64): nome em UTF-16 a partir do byte 44
    entry.writeUInt32LE(SIZE, 0);
    for (let ok = snap.first(h, entry); ok; ok = snap.next(h, entry)) {
      const raw = entry.subarray(44, 44 + 520).toString('utf16le');
      names.add(raw.slice(0, raw.indexOf('\0') >>> 0).replace(/\.exe$/i, '').toLowerCase());
    }
    snap.close(h);
    return [...names];
  } catch { snap = false; return null; }
}
let procCache = null;
/** Nomes dos processos em execução (sem ".exe", minúsculas). */
function processNames() {
  if (procCache && Date.now() - procCache.at < 2000) return procCache.list;
  const direct = snapshotNames();
  const list = direct ? Promise.resolve(direct) : run('tasklist.exe', ['/FO', 'CSV', '/NH']).then(out =>
    [...new Set(out.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map(n => n.replace(/\.exe$/i, '').toLowerCase()))]);
  procCache = { at: Date.now(), list };
  return list;
}

/** Comando e argumentos de uma tarefa agendada (pelo XML dela), ou null se não existir. */
async function scheduledTask(name) {
  const xml = await run('schtasks.exe', ['/Query', '/TN', name, '/XML']);
  if (!xml) return null;
  const tag = t => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''; };
  return { command: tag('Command'), arguments: tag('Arguments') };
}

module.exports = { regQuery, regValue, processNames, scheduledTask, powershell, psQuote, elevate, schtasks };
