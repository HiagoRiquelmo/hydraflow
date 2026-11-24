import { app, on, emit, set, effectById, setEffects, deviceSettings } from './state.js';
import { runner } from './effectRunner.js';
import { startSampler } from './sampler.js';
import * as playback from './playback.js';
import { h, modal, toast, switchEl, closeAllModals } from './ui.js';
import { renderLighting } from './views/lighting.js';
import { renderDevices } from './views/devices.js';
import { renderScreen } from './views/screen.js';
import { renderWallpaper } from './views/wallpaper.js';
import { renderCooler } from './views/cooler.js';
import { startAutoSetup } from './autoSetup.js';
import { startCoolerStream } from './coolerStream.js';
import { builtinComponents } from './components.js';
import { initI18n, t, languages, currentLang, setLanguage } from './i18n.js';

// A biblioteca de efeitos mora em Iluminação → Efeitos (1.0): "effects" (atalhos antigos, última aba salva) abre lá
const views = { lighting: renderLighting, screen: renderScreen, wallpaper: renderWallpaper, cooler: renderCooler, devices: renderDevices };
let disposeView = null;

function showView(name, opts = {}) {
  if (name === 'effects') { name = 'lighting'; opts = { ...opts, tab: 'effects' }; }
  if (!views[name]) name = 'lighting';
  disposeView?.();
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const root = document.getElementById('view');
  // cada tela ganha um contêiner próprio: se uma tela antiga terminar um trabalho assíncrono
  // (ex.: await da RAM) depois da troca de aba, ela redesenha num elemento que já saiu
  // da página, em vez de sobrescrever a tela nova
  const host = document.createElement('div');
  host.className = 'view-host';
  root.replaceChildren(host);
  disposeView = views[name](host, opts) || null;
  set('ui.view', name, { silent: true });
  // leitores de tela: após trocar de página o foco vai para o conteúdo
  if (opts.focus) root.focus({ preventScroll: true });
}

async function loadComponents() { app.components = [...builtinComponents(), ...await window.api.components.list()]; }

function handleEngine(msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'devices':
      app.devices = new Map(payload.map(d => [d.id, d]));
      emit('devices');
      break;
    case 'device':
      app.devices.set(payload.id, payload);
      emit('devices', payload.id);
      break;
    case 'log': {
      const list = app.logs.get(payload.id) || [];
      list.push(payload.line);
      if (list.length > 600) list.splice(0, list.length - 600);
      app.logs.set(payload.id, list);
      emit('log', payload.id);
      break;
    }
    case 'logs':
      app.logs.set(payload.id, payload.lines);
      emit('log', payload.id);
      break;
    case 'catalog': // catálogo novo = motor (re)iniciado: o aviso de erro anterior não vale mais
      app.engineInfo = { ...app.engineInfo, ...payload, lastError: null };
      emit('engineinfo');
      break;
    case 'ram':
      app.ram = payload;
      emit('ram');
      break;
    case 'gpus': // placas de vídeo encontradas (com ou sem LEDs controláveis)
      app.gpus = payload;
      emit('gpus');
      break;
    case 'hardwareSaveResult':
      emit('hardwareSaveResult', payload);
      break;
    case 'deviceParams': { // o motor mudou parâmetros ao salvar no dispositivo: a cópia daqui não pode desfazer
      const s = deviceSettings(payload.id);
      Object.assign(s.params, payload.params);
      emit('devices', payload.id);
      break;
    }
    case 'error':
      app.engineInfo.lastError = payload;
      emit('engineinfo');
      toast(payload, 'err');
      break;
  }
}

async function openSettings() {
  const dirs = await window.api.folders.userDirs();
  const appCfg = app.store.app || {};
  const setApp = (k, v) => set('app', { ...(app.store.app || {}), [k]: v });
  const folderList = (kind, title, hint) => {
    const box = h('div', { class: 'col' });
    const render = list => {
      app.store[`${kind}Folders`] = list;
      box.innerHTML = '';
      box.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, title),
        h('button', { class: 'btn sm', onclick: async () => render(await window.api.folders.add(kind)) }, t('settings.addFolder'))));
      box.append(h('div', { class: 'dim' }, hint));
      for (const f of list) box.append(h('div', { class: 'row' }, h('span', { class: 'grow dim', style: { wordBreak: 'break-all' } }, f),
        h('button', { class: 'btn sm danger', onclick: async () => render(await window.api.folders.remove(kind, f)) }, t('common.remove'))));
    };
    render(app.store[`${kind}Folders`] || []);
    return box;
  };

  // idioma: troca na hora (a janela se redesenha e o modal fecha para reabrir já traduzido)
  const langSelect = h('select', { class: 'input', 'aria-label': t('settings.language'), onchange: async e => {
    await setLanguage(e.target.value);
    dlg.close(true);
    openSettings();
  } }, languages().map(l => h('option', { value: l.id, selected: l.id === currentLang() }, l.name)));

  const body = h('div', { class: 'col', style: { width: '620px', gap: '10px' } },
    h('div', { class: 'panel col' },
      h('h3', {}, t('settings.app')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, t('settings.language')), h('div', { class: 'dim' }, t('settings.languageHint'))), langSelect),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t('settings.startWithWindows')), switchEl(appCfg.startWithWindows, v => setApp('startWithWindows', v))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t('settings.closeToTray')), switchEl(appCfg.closeToTray !== false, v => setApp('closeToTray', v)))),
    h('details', { class: 'panel' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('settings.advanced')),
      h('div', { class: 'col', style: { marginTop: '12px', gap: '14px' } },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, t('settings.gpu')),
          h('div', { class: 'dim' }, t('settings.gpuHint'))),
          switchEl(!!appCfg.gpu, v => { setApp('gpu', v); toast(t('settings.gpuRestart')); })),
        h('div', { class: 'dim' }, t('settings.userFolder', { path: dirs.base })),
        folderList('plugin', t('settings.pluginFolders'), t('settings.pluginFoldersHint')),
        folderList('component', t('settings.componentFolders'), t('settings.componentFoldersHint')),
        folderList('effect', t('settings.effectFolders'), t('settings.effectFoldersHint')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, t('settings.virtual')), h('div', { class: 'dim' }, t('settings.virtualHint'))),
          switchEl(app.store.virtualDevices, v => set('virtualDevices', v))))));
  const dlg = modal(t('settings.title'), body, [{ label: t('common.close'), primary: true }]);
  await dlg;
  await loadComponents();
  setEffects(await window.api.effects.list());
}

async function boot() {
  app.store = await window.api.store.get();
  await initI18n();
  // idioma trocado em Ajustes: a tela atual se redesenha já traduzida (os textos fixos do index.html o i18n.js troca)
  on('lang', () => { if (disposeView) showView(app.store.ui.view); });
  app.effects = await window.api.effects.list();
  await loadComponents();
  window.api.engine.on(handleEngine);
  for (const msg of await window.api.engine.snapshot()) handleEngine(msg);
  runner.mount(document.getElementById('fxFrameHost'));
  runner.setPaused(app.store.canvasPaused);
  startSampler();
  startAutoSetup();
  startCoolerStream();

  window.api.onTray(a => { if (a === 'next') playback.next(); else if (a === 'pause') playback.setPaused(!app.store.canvasPaused); });
  // janela escondida na bandeja: desmonta a tela atual (prévias, editor, listas) e deixa só o efeito + envio aos dispositivos
  let backgrounded = false;
  window.api.onBackground(bg => {
    if (bg && !backgrounded) {
      backgrounded = true;
      disposeView?.(); disposeView = null;
      document.getElementById('view').innerHTML = '';
      closeAllModals();
    } else if (!bg && backgrounded) {
      backgrounded = false;
      showView(app.store.ui.view);
    }
  });

  on('navigate', ({ name, opts }) => showView(name, opts));
  // foco no conteúdo só quando a troca veio do teclado (detail === 0), para não roubar o anel de foco do mouse
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.onclick = e => showView(b.dataset.view, { focus: e.detail === 0 }));
  document.getElementById('btnSettings').onclick = openSettings;

  const fx = effectById(app.store.activeEffect) || playback.fallbackEffect();
  if (fx) await playback.applyEffect(fx.id, { keepTimer: true });
  playback.resumeOnStartup();

  window.api.system.conflicts().then(list => { app.conflicts = list; emit('conflicts'); });
  showView(app.store.ui.view);
}

boot().catch(e => { console.error(e); toast(t('app.bootFailed', { error: e.message }), 'err'); });
