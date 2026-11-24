'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, powerMonitor, nativeTheme, net, Tray, Menu, nativeImage, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Store } = require('./store');
const { EffectCatalog } = require('./effects');
const { listComponents } = require('./components');
const { Explore } = require('./explore');
const { RamSupport } = require('./ramSupport');
const { Library, EXTS: MEDIA_EXTS, VIDEO } = require('./library');
const { CoolerLcd, setTranslator: setLcdTranslator } = require('./coolerLcd');
const migrations = require('./migrations');
const { regValue, processNames } = require('../common/winsys');
const { helperPaths, parseHelperArgs } = require('../smbus/protocol');
const { createI18n, LANGS, normalize } = require('../common/i18n');
const { STATE_MESSAGES, UI_COMMANDS, WLED_MAX_LEDS } = require('../engine/protocol');
const crypto = require('crypto');

const helperMode = parseHelperArgs(process.argv, app.getPath('userData'));
if (helperMode) {
  app.disableHardwareAcceleration();
  const { dataDir, taskArgs, register, installDriver } = helperMode;
  // o auxiliar roda como Node puro (bem mais leve que uma instância completa do Electron);
  // este processo só o inicia (herdando o privilégio elevado) e sai.
  try {
    const opts = Buffer.from(JSON.stringify({ exe: process.execPath, taskArgs, register, installDriver })).toString('base64');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'smbus', 'helperMain.js'), `--data-dir=${dataDir}`, `--opts=${opts}`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: 'ignore', windowsHide: true
    });
    child.unref();
    app.exit(0);
  } catch {
    app.on('window-all-closed', () => {});
    require('../smbus/helper').runHelper({ dataDir, exe: process.execPath, taskArgs, register, installDriver });
  }
  return;
}

// processo do papel de parede animado (iniciado pelo próprio app; tem a placa de vídeo ligada)
if (process.argv.some(a => a.startsWith('--hydraflow-wallpaper='))) { require('../wallpaper/wallpaperMain'); return; }

// Chamado pelo instalador (build/installer.nsh): deixa o RGB das memórias pronto já na instalação — driver e
// módulos oficiais que vêm dentro do app, uma única permissão do Windows — e sai. Sem janela, sem motor.
if (process.argv.includes('--setup-ram')) {
  app.whenReady().then(async () => {
    const dataDir = app.getPath('userData');
    const log = msg => { try { fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true }); fs.appendFileSync(path.join(dataDir, 'logs', 'hydraflow.log'), `[${new Date().toISOString()}] instalador: ${msg}\n`); } catch {} };
    try {
      const r = await new RamSupport({ app, net, dataDir }).preinstall(path.join(process.resourcesPath, 'pawnio'));
      // instalar = querer o app na bandeja cuidando dos LEDs: começa junto com o Windows
      const s = new Store(dataDir); s.set('app.startWithWindows', true); if (r.ok) s.set('ram.enabled', true); s.saveNow();
      log(r.ok ? 'RGB das memórias ativado' : `RGB das memórias não ativado: ${r.error}`);
    } catch (e) { log(`erro na ativação da RAM: ${e.message}`); }
    app.exit(0);
  });
  return;
}

// --profile=<pasta>: só para testes de desenvolvimento — dados e "Documentos" isolados (roda ao lado do app instalado)
const devProfile = process.argv.find(a => a.startsWith('--profile='))?.slice(10);
if (devProfile) { app.setPath('userData', path.join(devProfile, 'data')); app.setPath('documents', path.join(devProfile, 'docs')); }

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const ROOT = path.join(__dirname, '..', '..');
// --no-hardware: só para testes de desenvolvimento (não carrega plugins de hardware, RAM, WLED nem placas de vídeo)
const NO_HW = process.argv.includes('--no-hardware');
const DATA = app.getPath('userData');

migrations.fromRgbStudio({ app, dataDir: DATA });
const store = new Store(DATA);
// GPU desligada por padrão: a interface e os efeitos 2D não precisam dela, e assim o app não ocupa
// a placa de vídeo nem a memória do processo de GPU (~80 MB). Religável em Ajustes (efeitos WebGL).
if (!store.get('app.gpu')) app.disableHardwareAcceleration();

// idioma do app (Ajustes): textos da bandeja, diálogos e mensagens que o principal manda para a janela
let i18n = createI18n(store.get('app.language'));
const t = (key, vars) => i18n.t(key, vars);
setLcdTranslator(t);

let win = null;
let tray = null;
let engine = null;
let catalog = null;
let explore = null;
let ram = null;
let cooler = null;
let quitting = false;
let systemInfo = {};
const engineCache = {};

app.on('second-instance', () => showWindow());

const USER = (() => {
  const base = path.join(app.getPath('documents'), 'Hydraflow');
  const dirs = { base, effects: path.join(base, 'Effects'), plugins: path.join(base, 'Plugins'), components: path.join(base, 'Components') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
})();

// prioridade: plugins do usuário > pastas extras > plugins próprios incluídos no app
function pluginFolders() {
  if (NO_HW) return [path.join(ROOT, 'plugins', 'virtual')].filter(f => fs.existsSync(f));
  return [USER.plugins, ...store.get('pluginFolders'), path.join(ROOT, 'plugins')].filter(f => fs.existsSync(f));
}
function componentFolders() {
  return [USER.components, ...store.get('componentFolders'), path.join(ROOT, 'components')].filter(f => fs.existsSync(f));
}

// o que o motor precisa saber da configuração, por chave raiz do store: gravar uma delas avisa o motor (setConfig)
const engineConfig = {
  ram: () => ({ enabled: !NO_HW && !!store.get('ram.enabled'), connFile: helperPaths(DATA).connFile }),
  virtualDevices: () => !!store.get('virtualDevices'),
  wled: () => (NO_HW ? [] : store.get('wled')),
  pluginFolders
};
const engineConfigAll = () => Object.fromEntries(Object.entries(engineConfig).map(([k, f]) => [k, f()]));
/** RAM recém-ativada ou auxiliar de pé de novo: o motor conecta já, sem esperar a próxima varredura (5 s). */
const engineConnectRam = () => engineSend('config', { ram: engineConfig.ram() });

/** Grava no store e, se a chave interessa ao motor ou ao sistema, avisa quem precisa. Toda gravação passa por aqui. */
function setConfig(keyPath, value) {
  store.set(keyPath, value);
  const dev = keyPath.match(/^devices\.([^.]+)/);
  if (dev) engineSend('settings', { id: dev[1], settings: store.get(`devices.${dev[1]}`) });
  const root = keyPath.split('.')[0];
  if (root in engineConfig) engineSend('config', { [root]: engineConfig[root]() });
  if (root === 'app') { applyLoginItem(); applyLanguage(); }
  if (root === 'wallpaper') startWallpaper();
}

// ---- captura de tela nativa (src/capture/dxgiCapture.js): só existe enquanto o Ambiente da Tela está ligado
let captureProc = null;
function startCapture(fps) {
  return new Promise(resolve => {
    if (!captureProc) {
      const p = captureProc = utilityProcess.fork(path.join(ROOT, 'src', 'capture', 'dxgiCapture.js'), [], { serviceName: 'Hydraflow Captura', stdio: 'ignore' });
      // parar e ligar de novo em menos de 500 ms: o processo antigo sai depois que o novo já existe — esse não conta
      p.on('exit', () => { if (captureProc === p) { captureProc = null; toRenderer('screen:nativeStatus', { ok: false, error: t('main.captureStopped') }); } });
      p.on('message', m => {
        if (m.type === 'frame') toRenderer('screen:frame', m); // a janela pode já ter sido destruída (reinício, saída)
        else if (m.type === 'status') { toRenderer('screen:nativeStatus', m); p.pending?.(m); p.pending = null; }
      });
    }
    const timer = setTimeout(() => resolve({ ok: false, error: t('main.captureNoAnswer') }), 5000);
    captureProc.pending = m => { clearTimeout(timer); resolve(m); };
    captureProc.postMessage({ type: 'start', fps, lang: i18n.lang });
  });
}
function stopCapture() { const p = captureProc; captureProc = null; if (p) { try { p.postMessage({ type: 'stop' }); } catch {} setTimeout(() => { try { p.kill(); } catch {} }, 500); } }

// ---- papel de parede animado: um processo à parte (src/wallpaper), reiniciado a cada mudança de ajuste
let wallpaperProc = null;
const wallpaperStatus = patch => toRenderer('wallpaper:status', patch);

function startWallpaper() {
  stopWallpaper();
  const w = store.get('wallpaper');
  if (!w.enabled || !w.file) return wallpaperStatus({ running: false, error: null });
  if (!fs.existsSync(w.file)) return wallpaperStatus({ running: false, error: t('main.fileGone') });
  // o processo do papel de parede sai quando este arquivo some (ou quando este processo morre)
  for (const f of fs.readdirSync(DATA)) if (/^papel-de-parede-\d+\.run$/.test(f)) fs.rmSync(path.join(DATA, f), { force: true });
  const runFile = path.join(DATA, `papel-de-parede-${Date.now()}.run`);
  fs.writeFileSync(runFile, '');
  const cfg = Buffer.from(JSON.stringify({ file: w.file, fit: w.fit, pauseFullscreen: w.pauseFullscreen, pauseMaximized: !!w.pauseMaximized, runFile, parentPid: process.pid, lang: i18n.lang })).toString('base64');
  const p = wallpaperProc = spawn(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), `--hydraflow-wallpaper=${cfg}`],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  p.runFile = runFile;
  let error = null;
  p.stdout.on('data', d => { const m = String(d).match(/^erro (.*)/m); if (m) error = m[1]; });
  p.on('exit', code => {
    if (wallpaperProc === p) { wallpaperProc = null; wallpaperStatus({ running: false, error: code ? (error || t('main.wallpaperStopped')) : null }); }
  });
  wallpaperStatus({ running: true, error: null });
}

/** Para o papel de parede. A promessa termina quando o processo saiu (e soltou o arquivo que estava tocando). */
function stopWallpaper() {
  const p = wallpaperProc;
  if (!p) return Promise.resolve();
  wallpaperProc = null;
  try { fs.rmSync(p.runFile, { force: true }); } catch {}
  return new Promise(resolve => {
    if (p.exitCode !== null) return resolve();
    p.once('exit', () => resolve());
    // se não sair sozinho em 3 s: encerra à força e pede ao Windows para redesenhar o papel de parede normal
    setTimeout(() => {
      if (p.exitCode !== null) return;
      try { p.kill(); } catch {}
      try { require('../wallpaper/desktop').refreshWallpaper(); } catch {}
    }, 3000);
  });
}

// ---- biblioteca de mídia (src/main/library.js): imagens, GIFs e vídeos do papel de parede e do cooler
const library = new Library(DATA);

/** O que cada função está usando agora: { wallpaper: id|null, cooler: id|null } (id = item da biblioteca). */
function mediaUsage() {
  const w = store.get('wallpaper'), c = store.get('cooler');
  return { wallpaper: library.byPath(w.file)?.id || null, cooler: library.byPath(c.image)?.id || null,
    wallpaperOn: !!(w.enabled && w.file), coolerOn: c.enabled !== false && !!c.image };
}
const libraryPayload = () => ({ items: library.list(), totalBytes: library.totalBytes(), usage: mediaUsage() });

function buildCatalog() {
  // ids das pastas extras não podem depender da posição na lista: favoritos, playlists e ajustes usam essas ids
  const extraKey = dir => 'extra-' + crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 8);
  catalog = new EffectCatalog([
    { key: 'builtin', dir: path.join(ROOT, 'effects'), removable: false },
    { key: 'user', dir: USER.effects, removable: true },
    ...store.get('effectFolders').map(dir => ({ key: extraKey(dir), dir, removable: false }))
  ], { thumbDir: path.join(DATA, 'thumbs'), userDir: USER.effects });
  const list = catalog.scan();
  // efeitos baixados do pacote que vem com o app: a janela mostra nome e descrição traduzidos (locales/*/extras.json)
  const extrasIds = new Map();
  for (const { file, extrasId } of explore?.installedExtras() || []) {
    const id = catalog.idForFile(file);
    if (id) extrasIds.set(id, extrasId);
  }
  for (const e of list) if (extrasIds.has(e.id)) e.extrasId = extrasIds.get(e.id);
  return list;
}

function toRenderer(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

// placa-mãe e processador pelo registro (o mesmo que o Windows guarda do SMBIOS): ~30 ms, em vez de um PowerShell
// com CIM (~1 s) que a abertura do app esperava antes de mostrar a janela
async function loadSystemInfo() {
  if (process.platform !== 'win32') return {};
  const bios = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS';
  const [motherboard, manufacturer, cpu] = await Promise.all([regValue(bios, 'BaseBoardProduct'), regValue(bios, 'BaseBoardManufacturer'),
    regValue('HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0', 'ProcessorNameString')]);
  return { motherboard: motherboard || 'Unknown', manufacturer: manufacturer || 'Unknown', cpu: cpu || '' };
}

// outros programas de RGB abertos (disputariam os mesmos dispositivos), com o nome como o Windows mostra
const CONFLICTS = { signalrgb: 'SignalRgb', icue: 'iCUE', lightingservice: 'LightingService', armourycrate: 'ArmouryCrate', openrgb: 'OpenRGB' };
async function conflictingApps() {
  if (process.platform !== 'win32') return [];
  const running = await processNames();
  return Object.entries(CONFLICTS).filter(([k]) => running.includes(k)).map(([, name]) => name);
}

// motor que cai logo ao abrir (driver, plugin quebrado): reinicia esperando 1,5 s, 3 s, 6 s… até 1 min, em vez de
// ficar num laço de 1,5 s o dia inteiro; volta ao normal depois de 1 min funcionando
let engineFails = 0, engineStartedAt = 0;
function startEngine() {
  engineStartedAt = Date.now();
  // o app é empacotado sem .asar (package.json "asar": false), então o motor está sempre no caminho normal
  engine = utilityProcess.fork(path.join(ROOT, 'src', 'engine', 'engine.js'), [], { serviceName: 'Hydraflow Engine', stdio: 'pipe' });
  engine.stdout?.on('data', d => console.log('[engine] ' + String(d).trimEnd()));
  engine.stderr?.on('data', d => console.error('[engine] ' + String(d).trimEnd()));
  engine.on('message', msg => {
    if (msg.type === 'stopped') engine.emit('stopped');
    // o plugin mudou parâmetros ao salvar no dispositivo (ex.: "Ao fechar o app" → "Gravado no dispositivo"): guarda
    // (a janela recebe a mesma mensagem e atualiza a cópia dela; o motor recebe os ajustes de volta, para recarregar igual)
    if (msg.type === 'deviceParams') for (const [k, v] of Object.entries(msg.payload.params || {})) setConfig(`devices.${msg.payload.id}.params.${k}`, v);
    // mensagens de estado (a última de cada tipo vale) ficam guardadas para uma interface que recarregue; eventos não
    if (STATE_MESSAGES.includes(msg.type)) engineCache[msg.type] = msg;
    if (msg.type === 'device' && engineCache.devices) {
      const list = engineCache.devices.payload;
      const i = list.findIndex(d => d.id === msg.payload.id);
      if (i >= 0) list[i] = msg.payload; else list.push(msg.payload);
    }
    toRenderer('engine', msg);
  });
  engine.on('exit', code => {
    toRenderer('engine', { type: 'error', payload: t('main.engineExited', { code }) });
    engine = null;
    engineFails = Date.now() - engineStartedAt > 60000 ? 0 : engineFails + 1;
    if (!quitting) setTimeout(startEngine, Math.min(60000, 1500 * 2 ** Math.max(0, engineFails - 1)));
  });
  engine.postMessage({
    type: 'init',
    payload: {
      deviceSettings: store.get('devices'), systemInfo,
      cachePath: path.join(DATA, 'plugin-cache.json'), shutdownLog: path.join(DATA, 'shutdown-log.txt'),
      language: i18n.lang, noHardware: NO_HW, // --no-hardware: nem placas de vídeo
      ...engineConfigAll()
    }
  });
}

function engineSend(type, payload) { if (engine) engine.postMessage({ type, payload }); }

function stopEngine(suspending = false) {
  return new Promise(resolve => {
    if (!engine) return resolve();
    const t = setTimeout(resolve, 2000);
    engine.once('stopped', () => { clearTimeout(t); resolve(); });
    engineSend('shutdown', { suspending });
  });
}

// .ico com 16–256 px desenhados um a um (scripts/make-icon.js): o Windows escolhe o tamanho certo para a
// bandeja, a barra de tarefas e o Alt+Tab, em vez de encolher a imagem de 512 px (que ficava borrada).
function iconPath() { return path.join(ROOT, 'build', 'icon.ico'); }

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  if (tray) return;
  const img = fs.existsSync(iconPath()) ? nativeImage.createFromPath(iconPath()) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Hydraflow');
  trayMenu();
  tray.on('click', showWindow);
}
function trayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: t('main.trayOpen'), click: showWindow },
    { label: t('main.trayNext'), click: () => toRenderer('tray', 'next') },
    { label: t('main.trayPause'), click: () => toRenderer('tray', 'pause') },
    { type: 'separator' },
    { label: t('main.trayQuit'), click: () => app.quit() }
  ]));
}

/** Idioma trocado em Ajustes: tudo que o principal mostra passa a sair no idioma novo, sem reiniciar. */
function applyLanguage() {
  const lang = store.get('app.language');
  if (lang === i18n.lang) return;
  i18n = createI18n(lang);
  trayMenu();
  engineSend('config', { language: i18n.lang });
}
const i18nPayload = () => ({ lang: i18n.lang, dict: i18n.dict, base: i18n.base, langs: LANGS });

function createWindow() {
  nativeTheme.themeSource = 'dark';
  const startHidden = process.argv.includes('--hidden');
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0b0f1a',
    title: 'Hydraflow',
    icon: fs.existsSync(iconPath()) ? iconPath() : undefined,
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // não há campo de texto que precise; evita carregar (e baixar) dicionários
      backgroundThrottling: false
    }
  });
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('hide', onHidden);
  win.on('minimize', onHidden);
  win.on('show', onShown);
  win.on('restore', onShown);
  if (startHidden) win.webContents.once('did-finish-load', onHidden);
  win.on('close', e => {
    // fechar a janela mantém a iluminação rodando na bandeja
    if (!quitting && store.get('app.closeToTray') !== false) { e.preventDefault(); win.hide(); }
  });
}

// Escondida (bandeja) ou minimizada por um tempo: a interface desmonta a tela atual e
// devolvemos ao Windows a memória que ficou parada. O efeito e os dispositivos continuam rodando.
let bgTimer = null;
function onHidden() {
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => {
    toRenderer('window:background', true);
    bgTimer = setTimeout(trimMemory, 4000);
  }, 15000);
}
function onShown() {
  clearTimeout(bgTimer);
  bgTimer = null;
  toRenderer('window:background', false);
}

let winApi = null;
function trimMemory() {
  if (process.platform !== 'win32') return;
  try {
    if (!winApi) {
      const koffi = require('koffi');
      const k32 = koffi.load('kernel32.dll');
      winApi = {
        open: k32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
        close: k32.func('bool __stdcall CloseHandle(void* h)'),
        trim: k32.func('bool __stdcall SetProcessWorkingSetSize(void* h, intptr_t min, intptr_t max)')
      };
    }
    for (const m of app.getAppMetrics()) {
      const h = winApi.open(0x0100 | 0x0400, false, m.pid); // PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION
      if (!h) continue;
      winApi.trim(h, -1, -1);
      winApi.close(h);
    }
  } catch (e) { console.error('trimMemory:', e.message); }
}

// Cópia de build (dist\win-unpacked) ou app sem empacotar: não é a instalação de verdade. Ela NUNCA registra a
// inicialização com o Windows — antes registrava, e no boot abria a cópia da pasta de build (recriada a cada
// "npm run dist", sem a tarefa da RAM), que ainda tomava a instância única do app instalado.
const isBuildCopy = () => !app.isPackaged || /[\\/]win-unpacked[\\/]/i.test(process.execPath);
let loginItemOn = null; // o que já foi registrado no Windows (mudar o idioma ou a GPU não registra de novo)
function applyLoginItem() {
  if (isBuildCopy()) return;
  const on = !!store.get('app.startWithWindows');
  if (on === loginItemOn) return;
  loginItemOn = on;
  // nome antigo (padrão do Electron, compartilhado por todas as cópias): sai sempre, para não sobrar caminho velho
  app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Hydraflow' });
  app.setLoginItemSettings({ openAtLogin: on, name: 'Hydraflow', path: process.execPath, args: ['--hidden'] });
}

// ---- log em disco (logs/hydraflow.log): o que o app e o motor disseram, para entender um boot que deu errado
const LOG_FILE = path.join(DATA, 'logs', 'hydraflow.log');
(function startFileLog() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {}
  const write = (level, args) => {
    const line = args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${level} ${line}\n`); } catch {}
  };
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => { orig(...a); write(level, a); };
  }
  console.log(`=== Hydraflow ${app.getVersion()} iniciando (${process.argv.includes('--hidden') ? 'com o Windows' : 'aberto pela pessoa'}) — ${process.execPath}`);
})();

// ---- logo depois do boot o USB, o driver da RAM (PawnIO) e a captura de tela podem ainda não estar prontos:
// procura os dispositivos de novo algumas vezes e insiste no auxiliar da RAM por até 2 minutos
function bootRetries() {
  const atLogin = process.argv.includes('--hidden') || require('os').uptime() < 300;
  if (!atLogin) return;
  console.log('Início junto com o Windows: novas buscas de dispositivos em 10 s, 30 s e 60 s');
  for (const s of [10, 30, 60]) setTimeout(() => { if (!quitting) { console.log(`Busca de dispositivos (+${s} s)`); engineSend('rescan', {}); } }, s * 1000);
  let tries = 0;
  const ramTimer = setInterval(async () => {
    if (quitting || NO_HW || !store.get('ram.enabled') || ++tries > 12) { clearInterval(ramTimer); return; }
    if (await ram.helperAlive()) { clearInterval(ramTimer); return; }
    console.log(`Auxiliar da RAM ainda não respondeu: tentativa ${tries}`);
    resumeRam();
  }, 10000);
}


function registerIpc() {
  ipcMain.handle('i18n:get', () => i18nPayload());
  ipcMain.handle('i18n:set', (_, lang) => { setConfig('app.language', normalize(lang)); return i18nPayload(); });
  ipcMain.handle('store:get', () => store.get());
  ipcMain.on('store:set', (_, keyPath, value) => setConfig(keyPath, value));

  ipcMain.handle('effects:list', () => buildCatalog());
  ipcMain.handle('effects:read', (_, id) => catalog.read(id));
  ipcMain.handle('effects:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: t('main.importEffect'), properties: ['openFile', 'multiSelections'], filters: [{ name: t('main.effectsFilter'), extensions: ['html', 'htm'] }] });
    if (r.canceled) return { imported: [] };
    // efeito de terceiro entra pelo Descobrir: só vai para a biblioteca quando a pessoa instalar
    const imported = explore.keepLocal(r.filePaths);
    return { imported, repeated: r.filePaths.length - imported.length };
  });
  ipcMain.handle('effects:uninstall', (_, id) => {
    try {
      // desinstalar devolve ao Descobrir: o que veio de lá volta sozinho; o resto fica guardado entre os recebidos
      explore.forgetFile(catalog.remove(id, file => { if (!explore.tracks(file)) explore.keepLocal([file]); }));
    } catch (e) { return { ok: false, error: e.code === 'not-removable' ? t('main.notRemovable') : e.message }; }
    return { ok: true, list: buildCatalog() };
  });
  ipcMain.handle('effects:openFolder', () => shell.openPath(catalog.userDir));
  ipcMain.handle('effects:saveThumb', (_, id, dataUrl) => catalog.saveThumb(id, dataUrl));

  ipcMain.handle('explore:list', (_, refresh) => explore.list(store.get('exploreSources'), !!refresh,
    { effectIdFor: file => catalog.idForFile(file), thumbFor: id => catalog.thumbUrl(id) }));
  ipcMain.handle('explore:read', (_, itemId) => explore.readEffect(itemId));
  ipcMain.handle('explore:install', async (_, itemId) => {
    const r = await explore.install(itemId, catalog.userDir);
    const list = buildCatalog();
    return { ...r, list, effectId: r.ok ? catalog.idForFile(r.file) : null };
  });
  // "Baixar todos": instala vários e relê a biblioteca uma vez só
  ipcMain.handle('explore:installMany', async (_, keys) => {
    const done = [], errors = [];
    for (const k of Array.isArray(keys) ? keys : []) {
      const r = await explore.install(k, catalog.userDir);
      if (r.ok) done.push({ key: k, file: r.file }); else errors.push(r.error);
    }
    const list = buildCatalog();
    return { installed: done.map(d => ({ key: d.key, effectId: catalog.idForFile(d.file) })), errors, list };
  });
  ipcMain.handle('explore:deleteLocal', (_, key) => explore.deleteLocal(key));
  ipcMain.handle('explore:addSource', async (_, url) => {
    if (!/^https:\/\//i.test(url)) return { ok: false, error: t('discover.needHttps') };
    try { await explore.fetchIndex(url); } catch (e) { return { ok: false, error: e.message }; }
    const list = [...new Set([...store.get('exploreSources'), url])];
    setConfig('exploreSources', list);
    return { ok: true, sources: list };
  });
  ipcMain.handle('explore:removeSource', (_, url) => {
    const list = store.get('exploreSources').filter(u => u !== url);
    setConfig('exploreSources', list);
    return list;
  });

  ipcMain.handle('components:list', () => listComponents(componentFolders()));

  ipcMain.handle('ram:status', () => ram.status());
  ipcMain.handle('ram:enable', async () => {
    setConfig('ram.enabled', true);
    const r = await ram.enable();
    if (r.ok) engineConnectRam();
    return r;
  });
  ipcMain.handle('app:relaunch', () => { app.relaunch(); app.quit(); });
  // Watercooler com tela (src/main/coolerLcd.js, protocolo em docs/protocolo-tela-gamdias.md)
  const coolerOff = () => !store.get('cooler.enabled'); // "Mostrar no cooler" desligado: nada reconecta a tela
  ipcMain.handle('cooler:status', () => cooler.status({ enabled: !coolerOff() }));
  ipcMain.handle('cooler:frame', (_, jpeg) => (coolerOff() ? false : cooler.frame(jpeg)));
  ipcMain.handle('cooler:ready', async () => !coolerOff() && !!(await cooler.ensure())); // procura no máximo a cada 15 s
  ipcMain.handle('cooler:imageData', () => fs.readFileSync(store.get('cooler.image')));
  // patch: { rotation?, brightness?, fit?, enabled?, item? } — item: id de uma imagem da biblioteca
  ipcMain.handle('cooler:set', (_, patch) => {
    const c = { ...store.get('cooler') };
    for (const k of ['rotation', 'brightness', 'fit', 'enabled']) if (k in patch) c[k] = patch[k];
    if ('item' in patch) { const it = library.get(patch.item); c.image = it && it.kind !== 'video' ? library.fileOf(it) : null; }
    setConfig('cooler', c);
    if ('brightness' in patch) cooler.setBrightness(c.brightness);
    if (patch.enabled === false) cooler.close();
    return c;
  });
  // controladoras WLED na rede: confere o endereço pela API JSON do próprio WLED (nome e quantidade de LEDs)
  ipcMain.handle('wled:probe', async (_, host) => {
    host = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[\w.-]+(:\d+)?$/.test(host)) return { ok: false, error: t('main.badAddress') };
    try {
      const r = await net.fetch(`http://${host}/json/info`, { signal: AbortSignal.timeout(4000) });
      const info = await r.json();
      if (!info?.leds?.count) return { ok: false, error: t('main.notWled') };
      return { ok: true, host: host.split(':')[0], name: info.name || `WLED ${host}`, ledCount: info.leds.count, version: info.ver };
    } catch (e) { return { ok: false, error: e.name === 'AbortError' ? t('main.wledNoAnswer') : e.message }; }
  });
  ipcMain.handle('wled:set', (_, list) => {
    const clean = (Array.isArray(list) ? list : []).filter(w => w?.host && w.ledCount > 0)
      .map(w => ({ host: String(w.host), name: String(w.name || ''), ledCount: Math.min(WLED_MAX_LEDS, w.ledCount | 0) }));
    setConfig('wled', clean);
    return clean;
  });
  ipcMain.handle('wallpaper:get', () => ({ ...store.get('wallpaper'), running: !!wallpaperProc }));
  // patch: { enabled?, item?, fit?, pauseFullscreen?, pauseMaximized? } — item: id da biblioteca (escolher já liga)
  ipcMain.handle('wallpaper:set', (_, patch) => {
    const w = { ...store.get('wallpaper') };
    for (const k of ['enabled', 'fit', 'pauseFullscreen', 'pauseMaximized']) if (k in patch) w[k] = patch[k];
    if ('item' in patch) { const it = library.get(patch.item); w.file = it ? library.fileOf(it) : null; if (!it) w.enabled = false; }
    setConfig('wallpaper', w);
    return { ...w, running: !!wallpaperProc };
  });

  // biblioteca de mídia
  ipcMain.handle('library:list', () => libraryPayload());
  const importResult = async files => {
    const r = await library.add(files);
    return { ...r, ...libraryPayload() };
  };
  ipcMain.handle('library:import', async (_, onlyImages) => {
    const exts = MEDIA_EXTS.filter(e => !onlyImages || !VIDEO.includes(e)).map(e => e.slice(1));
    const r = await dialog.showOpenDialog(win, { title: t('main.mediaPick'), properties: ['openFile', 'multiSelections'], filters: [{ name: t('main.mediaFilter'), extensions: exts }] });
    return r.canceled ? { added: [], duplicates: [], skipped: [], ...libraryPayload() } : importResult(r.filePaths);
  });
  ipcMain.handle('library:importPaths', (_, files) => importResult((Array.isArray(files) ? files : []).filter(f => typeof f === 'string')));
  // miniatura pelo Windows (o mesmo que o Explorer mostra): funciona para vídeo, GIF e imagem sem decodificar nada aqui
  ipcMain.handle('library:thumb', async (_, id) => {
    const it = library.get(id);
    if (!it) return null;
    try {
      const img = await nativeImage.createThumbnailFromPath(library.fileOf(it), { width: 320, height: 320 });
      return img.isEmpty() ? null : library.saveThumb(id, img.toDataURL());
    } catch { return null; }
  });
  ipcMain.handle('library:rename', (_, id, name) => { library.rename(id, name); return libraryPayload(); });
  // excluir: se o arquivo está em uso (papel de parede ligado, tela do cooler) e force não veio, só avisa quem usa;
  // com force, desliga quem usa, espera soltar o arquivo e apaga
  ipcMain.handle('library:remove', async (_, id, force) => {
    const u = mediaUsage();
    const users = [u.wallpaper === id && u.wallpaperOn && 'wallpaper', u.cooler === id && u.coolerOn && 'cooler'].filter(Boolean);
    if (users.length && !force) return { ok: false, inUse: users };
    if (u.wallpaper === id) { await stopWallpaper(); setConfig('wallpaper', { ...store.get('wallpaper'), file: null, enabled: false }); }
    if (u.cooler === id) { setConfig('cooler.image', null); toRenderer('cooler:imageCleared', true); }
    try { library.remove(id); } catch (e) { return { ok: false, error: e.message, ...libraryPayload() }; }
    return { ok: true, ...libraryPayload() };
  });
  ipcMain.handle('library:openFolder', () => shell.openPath(library.dir));
  // captura nativa (DXGI) num processo à parte; os quadros (~120×68 RGBA) vão direto para a janela
  ipcMain.handle('screen:nativeStart', (_, fps) => startCapture(fps));
  ipcMain.handle('screen:nativeStop', () => stopCapture());
  ipcMain.handle('screen:source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const primary = String(screen.getPrimaryDisplay().id);
    return (sources.find(s => s.display_id === primary) || sources[0])?.id || null;
  });

  ipcMain.handle('folders:add', async (_, kind) => {
    const r = await dialog.showOpenDialog(win, { title: t('main.pickFolder'), properties: ['openDirectory'] });
    if (r.canceled) return store.get(`${kind}Folders`);
    const list = [...new Set([...store.get(`${kind}Folders`), r.filePaths[0]])];
    setConfig(`${kind}Folders`, list);
    return list;
  });
  ipcMain.handle('folders:remove', (_, kind, folder) => {
    const list = store.get(`${kind}Folders`).filter(f => f !== folder);
    setConfig(`${kind}Folders`, list);
    return list;
  });
  ipcMain.handle('folders:userDirs', () => USER);
  ipcMain.handle('system:conflicts', () => conflictingApps());

  ipcMain.handle('engine:snapshot', () => Object.values(engineCache));
  ipcMain.on('engine:frame', (_, payload) => engineSend('frame', payload));
  ipcMain.on('engine:cmd', (_, type, payload) => { if (UI_COMMANDS.includes(type)) engineSend(type, payload); });
  ipcMain.handle('shell:showItem', (_, p) => shell.showItemInFolder(p));
}

/** RGB das memórias: se já foi ativado, (re)inicia o auxiliar pela tarefa agendada, sem pedir permissão. */
function resumeRam() {
  if (NO_HW || !store.get('ram.enabled')) return;
  // auxiliar de pé: o motor conecta já, sem esperar a próxima varredura (5 s)
  ram.resumeHelper().then(ok => { if (ok) engineConnectRam(); });
}

app.whenReady().then(async () => {
  // remove pastas extras que não existem mais (ex.: programas desinstalados)
  for (const k of ['pluginFolders', 'componentFolders', 'effectFolders']) {
    const list = store.get(k);
    const ok = list.filter(f => fs.existsSync(f));
    if (ok.length !== list.length) store.set(k, ok);
  }
  cooler = new CoolerLcd({ onState: s => toRenderer('cooler:state', s), brightness: store.get('cooler.brightness') });
  ram = new RamSupport({ app, net, dataDir: DATA, t, onStatus: s => toRenderer('ram:status', s) });
  explore = new Explore({ net, dataDir: DATA, bundledDir: path.join(ROOT, 'efeitos-extras'), t });
  migrations.wledIds({ store });
  buildCatalog();
  registerIpc();
  createWindow(); // a janela não espera nada do sistema; o motor (que usa a placa-mãe nos plugins) vem logo depois
  win.once('ready-to-show', () => console.log(`[hydraflow] janela pronta ${Math.round(process.uptime() * 1000)} ms depois de abrir`));
  systemInfo = await loadSystemInfo();
  createTray();
  applyLoginItem();
  startEngine();
  resumeRam();
  bootRetries();
  await migrations.mediaToLibrary({ store, library }).catch(e => console.error('Biblioteca (migração):', e)); // nunca impede o app de abrir
  startWallpaper();

  powerMonitor.on('suspend', () => engineSend('shutdown', { suspending: true }));
  // na suspensão o motor parou e o auxiliar de memória pode ter saído por falta de clientes
  powerMonitor.on('resume', () => { console.log('Voltou da suspensão'); engineSend('resume', {}); resumeRam(); });
  // tela desbloqueada (entrar de novo na conta): outro programa pode ter tomado os dispositivos no bloqueio
  powerMonitor.on('unlock-screen', () => { console.log('Tela desbloqueada: buscando dispositivos'); engineSend('rescan', {}); resumeRam(); });
});

app.on('before-quit', async e => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  try { store.saveNow(); } catch (err) { console.error('Falha ao salvar a configuração:', err.message); }
  stopWallpaper();
  stopCapture();
  await cooler?.close();
  await stopEngine(false);
  try { engine?.kill(); } catch {}
  tray?.destroy();
  app.exit(0);
});

app.on('window-all-closed', () => { if (quitting) app.quit(); });
