'use strict';
// Janela por trás dos ícones da área de trabalho (o mesmo truque dos apps de papel de parede animado).
// Fatos do Windows usados aqui:
// - A mensagem 0x052C mandada ao "Progman" faz o Explorer criar uma janela "WorkerW" atrás dos ícones.
// - Até o Windows 11 23H2 esse WorkerW é uma janela de topo, irmã da que contém os ícones (SHELLDLL_DefView):
//   basta tornar a nossa janela filha dele.
// - No 24H2 em diante o WorkerW e os ícones ficam DENTRO do Progman: a nossa janela vira filha do Progman,
//   logo abaixo dos ícones e acima do WorkerW (que desenha o papel de parede normal).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const EnumProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr hwnd, intptr lp)');
const FindWindowW = user32.func('intptr __stdcall FindWindowW(str16 cls, str16 name)');
const FindWindowExW = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)');
const SendMessageTimeoutW = user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint32 msg, uintptr wp, intptr lp, uint32 flags, uint32 timeout, _Out_ uintptr *result)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lp)');
const SetParent = user32.func('intptr __stdcall SetParent(intptr child, intptr parent)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr h, intptr after, int x, int y, int cx, int cy, uint32 flags)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int i)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr h, int i)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr h, int i, intptr v)');
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr h, _Out_ int32_t *rect)');
const GetClientRect = user32.func('bool __stdcall GetClientRect(intptr h, _Out_ int32_t *rect)');
const ClientToScreen = user32.func('bool __stdcall ClientToScreen(intptr h, _Inout_ int32_t *pt)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr h, _Out_ uint16_t *buf, int max)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Inout_ uint16_t *pv, uint32 ini)');
const IsZoomed = user32.func('bool __stdcall IsZoomed(intptr h)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr h)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr h, _Out_ uint32_t *pid)');
const WinEventProc = koffi.proto('void __stdcall WinEventProc(intptr hook, uint32 event, intptr hwnd, int32 idObject, int32 idChild, uint32 thread, uint32 time)');
const SetWinEventHook = user32.func('intptr __stdcall SetWinEventHook(uint32 min, uint32 max, intptr hmod, WinEventProc *proc, uint32 pid, uint32 tid, uint32 flags)');
const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(intptr hook)');
const shell32 = koffi.load('shell32.dll');
const SHQueryUserNotificationState = shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)');

const GWL_STYLE = -16, WS_CHILD = 0x40000000, WS_POPUP = 0x80000000;
// bordas e barra de título: sobrando, o Windows reserva uma moldura invisível (~8 px) e o conteúdo não chega à borda
const WS_FRAME = 0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000; // CAPTION | THICKFRAME | SYSMENU | MINIMIZEBOX | MAXIMIZEBOX
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40;

/** HWND de uma janela do Electron. */
const hwndOf = win => Number(win.getNativeWindowHandle().readBigUInt64LE(0));

function className(h) {
  const buf = new Uint16Array(256);
  const n = GetClassNameW(h, buf, 256);
  return String.fromCharCode(...buf.subarray(0, n));
}

/** Descobre onde pendurar a janela: { parent, below } (below = janela dos ícones, quando ela está no mesmo pai). */
function desktopHost() {
  const progman = FindWindowW('Progman', null);
  // i18n: quem mostra o erro (wallpaperMain) traduz pela chave
  if (!progman) throw Object.assign(new Error('Progman not found'), { i18n: 'wallpaperProc.noProgman' });
  const out = [0];
  SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, out);
  SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, out);
  // 24H2+: WorkerW dentro do Progman
  const inner = FindWindowExW(progman, 0, 'WorkerW', null);
  if (inner) return { parent: progman, below: FindWindowExW(progman, 0, 'SHELLDLL_DefView', null), worker: inner };
  // antes do 24H2: o WorkerW que vem logo depois da janela que contém os ícones
  let worker = 0;
  EnumWindows((h) => {
    if (FindWindowExW(h, 0, 'SHELLDLL_DefView', null)) worker = FindWindowExW(0, h, 'WorkerW', null);
    return true;
  }, 0);
  if (!worker) throw Object.assign(new Error('WorkerW not found'), { i18n: 'wallpaperProc.noWorker' });
  return { parent: worker, below: 0, worker: 0 };
}

/** Pendura a janela atrás dos ícones, no retângulo físico (pixels da tela) dado. */
function attach(win, rect) {
  const h = hwndOf(win);
  const host = desktopHost();
  const style = Number(GetWindowLongPtrW(h, GWL_STYLE));
  SetWindowLongPtrW(h, GWL_STYLE, ((style & ~WS_POPUP & ~WS_FRAME) | WS_CHILD) >>> 0);
  SetParent(h, host.parent);
  place(win, rect, host);
  return host;
}

/** Área onde a página é desenhada, em pixels da tela: { x, y, w, h }. */
function clientBox(h) {
  const p = new Int32Array([0, 0]), c = new Int32Array(4);
  ClientToScreen(h, p); GetClientRect(h, c);
  return { x: p[0], y: p[1], w: c[2], h: c[3] };
}

/**
 * (Re)posiciona para que a ÁREA DA PÁGINA cubra exatamente o retângulo físico do monitor.
 * O Chromium mantém em janelas sem moldura uma borda invisível de redimensionar (~7 px à esquerda, à direita e
 * embaixo neste Windows): posicionar a janela no retângulo do monitor deixava uma faixa do papel de parede antigo
 * à esquerda/embaixo e empurrava a imagem para fora à direita. Aqui a borda de cada lado é medida (janela ×
 * área útil) e a janela é posta deslocada e maior na medida exata — vale para qualquer resolução e escala.
 */
function place(win, rect, host) {
  const h = hwndOf(win);
  // coordenadas dentro do pai começam no canto da tela virtual (pode ser negativo com vários monitores)
  const vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
  const flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED;
  SetWindowPos(h, host.below || 0, rect.x - vx, rect.y - vy, rect.width, rect.height, flags);
  const w = new Int32Array(4); GetWindowRect(h, w);
  const c = clientBox(h);
  const l = c.x - w[0], t = c.y - w[1], r = w[2] - (c.x + c.w), b = w[3] - (c.y + c.h);
  if (l || t || r || b) SetWindowPos(h, host.below || 0, rect.x - l - vx, rect.y - t - vy, rect.width + l + r, rect.height + t + b, flags);
  if (host.worker) SetWindowPos(host.worker, h, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

/** A área da página ainda cobre o monitor? (o Explorer reiniciado ou uma troca de resolução desfazem tudo) */
function covers(win, rect) {
  const c = clientBox(hwndOf(win));
  return c.x === rect.x && c.y === rect.y && c.w === rect.width && c.h === rect.height;
}

const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

/**
 * Monitores que a janela em primeiro plano esconde por inteiro. `mode`:
 * - 'fullscreen': só jogo/vídeo em tela cheia (sem moldura, do tamanho exato do monitor, ou o Windows dizendo
 *   que há um app em tela cheia/Direct3D exclusivo);
 * - 'covered': também uma janela maximizada (no Windows 11 ela passa ~8 px das bordas — antes isso era confundido
 *   com tela cheia, e o papel de parede sumia atrás do navegador maximizado).
 * A área de trabalho, a barra de tarefas e as janelas deste processo nunca contam.
 */
function coveredMonitors(monitors, mode = 'fullscreen') {
  const covered = new Set();
  const h = GetForegroundWindow();
  if (!h || !IsWindowVisible(h) || DESKTOP_CLASSES.has(className(h))) return covered;
  const pid = [0]; GetWindowThreadProcessId(h, pid);
  if (pid[0] === process.pid) return covered;
  const r = new Int32Array(4);
  if (!GetWindowRect(h, r)) return covered;
  const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
  const home = monitors.findIndex(m => cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
  const framed = (Number(GetWindowLongPtrW(h, GWL_STYLE)) & 0x00C00000) === 0x00C00000; // WS_CAPTION
  const state = [0];
  const osFullscreen = SHQueryUserNotificationState(state) === 0 && (state[0] === 2 || state[0] === 3); // QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN
  monitors.forEach((m, i) => {
    const spans = r[0] <= m.x && r[1] <= m.y && r[2] >= m.x + m.width && r[3] >= m.y + m.height;
    const fullscreen = spans && (!framed || osFullscreen) && !IsZoomed(h);
    if (fullscreen || (i === home && osFullscreen) || (mode === 'covered' && i === home && IsZoomed(h))) covered.add(i);
  });
  return covered;
}

/**
 * Chama `fn` assim que a janela em primeiro plano muda, é minimizada/restaurada ou muda de tamanho — em vez de
 * conferir de tempos em tempos (a volta para a área de trabalho tinha até 2 s de atraso). Precisa do laço de
 * mensagens da thread principal (o Electron tem). Devolve a função que desliga.
 */
function onForegroundChange(fn) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(fn, 30); }; // eventos vêm em rajada
  const cb = koffi.register((hook, event, hwnd, idObject) => {
    if (event === 0x800B && (idObject !== 0 || hwnd !== GetForegroundWindow())) return; // só a própria janela da frente
    fire();
  }, koffi.pointer(WinEventProc));
  const SKIP_OWN = 0x2; // WINEVENT_OUTOFCONTEXT (0) | WINEVENT_SKIPOWNPROCESS
  const hooks = [[0x0003, 0x0003], [0x0016, 0x0017], [0x800B, 0x800B]] // FOREGROUND, MINIMIZESTART..END, OBJECT_LOCATIONCHANGE
    .map(([a, b]) => SetWinEventHook(a, b, 0, cb, 0, 0, SKIP_OWN)).filter(Boolean);
  return () => { clearTimeout(timer); hooks.forEach(x => UnhookWinEvent(x)); koffi.unregister(cb); };
}

/** Faz o Windows redesenhar o papel de parede normal (depois que a nossa janela some). */
function refreshWallpaper() {
  const buf = new Uint16Array(520);
  if (!SystemParametersInfoW(0x73, buf.length, buf, 0)) return; // SPI_GETDESKWALLPAPER
  SystemParametersInfoW(0x14, 0, buf, 0x2);                     // SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE
}

module.exports = { attach, place, covers, coveredMonitors, onForegroundChange, refreshWallpaper, EnumProc };
