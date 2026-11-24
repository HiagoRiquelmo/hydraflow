'use strict';
// Processo do papel de parede animado: roda separado do app (com a placa de vídeo ligada, para o vídeo não
// pesar no processador), uma janela por monitor pendurada atrás dos ícones. O app principal inicia este
// processo com --hydraflow-wallpaper=<config em base64> e o encerra apagando o arquivo de controle
// (cfg.runFile) — um app Electron no Windows não tem entrada padrão utilizável. Também sai se o app cair.
// Pausa sozinho quando um jogo ou vídeo em tela cheia está na frente.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const desktop = require('./desktop');
const { createI18n } = require('../common/i18n');

const arg = process.argv.find(a => a.startsWith('--hydraflow-wallpaper='));
const cfg = JSON.parse(Buffer.from(arg.split('=')[1], 'base64').toString('utf8')); // { file, fit, pauseFullscreen, pauseMaximized }

// perfil próprio: não disputa a pasta (e o cache) com o app principal
app.setPath('userData', path.join(app.getPath('userData'), 'papel-de-parede'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// O Chromium considera "escondida" a janela coberta por outra e descarta o que estava desenhado; ao voltar para a
// área de trabalho ela precisava redesenhar do zero (tela preta por um instante). A pausa aqui é feita por nós.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const wins = [];
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const w of wins) if (!w.isDestroyed()) w.destroy();
  try { desktop.refreshWallpaper(); } catch {}
}

function create() {
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, skipTaskbar: true, resizable: false, focusable: false, hasShadow: false,
      backgroundColor: '#000000',
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false,
        preload: path.join(__dirname, 'wallpaperPreload.js') }
    });
    w.loadFile(path.join(__dirname, 'wallpaper.html'), { query: { src: pathToFileURL(cfg.file).href, fit: cfg.fit || 'cover' } });
    w.rect = screen.dipToScreenRect(null, d.bounds); // retângulo físico do monitor (pixels reais, com a escala do Windows)
    w.paused = false;
    w.once('ready-to-show', () => {
      try { w.host = desktop.attach(w, w.rect); w.showInactive(); syncPause(); }
      catch (e) { process.stdout.write('erro ' + (e.i18n ? createI18n(cfg.lang).t(e.i18n) : e.message) + '\n'); cleanup(); app.exit(1); }
    });
    wins.push(w);
  }
}

// a cada 3 s: a janela continua inteira atrás dos ícones? (o Explorer reiniciado destrói a camada; a
// troca de resolução ou de escala muda o tamanho) — corrige no lugar ou recria tudo
function watchdog() {
  if (cleaned) return;
  if (wins.some(w => w.isDestroyed())) return rebuild();
  for (const w of wins) {
    if (!w.host || desktop.covers(w, w.rect)) continue;
    try { w.host = desktop.attach(w, w.rect); } catch { return rebuild(); }
  }
}

// a página confere quantos pixels recebeu (diagnóstico e rede de segurança): se não bate com o monitor, reposiciona
ipcMain.on('size', (e, s) => {
  const w = wins.find(x => !x.isDestroyed() && x.webContents === e.sender);
  if (!w?.host) return;
  if (Math.round(s.w) !== w.rect.width || Math.round(s.h) !== w.rect.height) desktop.place(w, w.rect, w.host);
});

let rebuildTimer = null;
function rebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { for (const w of wins.splice(0)) if (!w.isDestroyed()) w.destroy(); if (!cleaned) create(); }, 800);
}

// Monitor escondido por um jogo/vídeo em tela cheia (ou, se escolhido, por uma janela maximizada): a janela daquele
// monitor para de tocar e mantém o último quadro na tela — voltar para a área de trabalho é instantâneo.
function syncPause() {
  if (cleaned) return;
  const covered = cfg.pauseFullscreen ? desktop.coveredMonitors(wins.map(w => w.rect), cfg.pauseMaximized ? 'covered' : 'fullscreen') : new Set();
  wins.forEach((w, i) => {
    const want = covered.has(i);
    if (w.isDestroyed() || w.paused === want) return;
    w.paused = want;
    w.webContents.send('pause', want);
  });
}

app.whenReady().then(() => {
  create();
  // reage na hora à troca de janela (minimizar, Win+D, alt+tab, maximizar); a conferência a cada 5 s só cobre
  // algum evento perdido
  try { desktop.onForegroundChange(syncPause); } catch (e) { process.stdout.write('aviso ' + e.message + '\n'); }
  setInterval(syncPause, 5000);
  // monitor conectado/desconectado ou resolução/escala trocada: recria tudo (com uma pequena espera, os eventos vêm em rajada)
  screen.on('display-added', rebuild); screen.on('display-removed', rebuild); screen.on('display-metrics-changed', rebuild);
  setInterval(watchdog, 3000);
});

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
setInterval(() => {
  if ((cfg.runFile && !fs.existsSync(cfg.runFile)) || (cfg.parentPid && !alive(cfg.parentPid))) { cleanup(); app.exit(0); }
}, 500);
app.on('window-all-closed', () => {});
app.on('before-quit', cleanup);
