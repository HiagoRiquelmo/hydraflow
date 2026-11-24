'use strict';
// Persistência simples em JSON (userData/config.json) com gravação atrasada.
const fs = require('fs');
const path = require('path');

const DEFAULTS = () => ({
  globalBrightness: 100,
  activeEffect: 'builtin:Basicos/Cor Solida.html',
  canvasPaused: false,
  effectParams: {},      // { [effectId]: { prop: value } }
  effectSpeed: {},       // { [effectId]: % } velocidade geral da animação (100 = normal)
  presets: {},           // { [effectId]: { [presetName]: { prop: value } } }
  favorites: [],         // [effectId]
  playlists: [],         // [{ id, name, effects: [effectId] }]
  timer: { intervalSec: 300, active: false, shuffle: false, playlistId: null },
  layouts: {
    current: 'Padrão',
    list: { 'Padrão': { brightness: 100, items: {} } }
  },
  devices: {},           // { [deviceId]: { enabled, alias, brightness, params, tuning, painting, channels } }
  ui: { showLeds: true, showGrid: true, view: 'lighting', lightingTab: 'effects', effectsTab: 'all' },
  // o app fica na bandeja controlando os LEDs: começa junto com o Windows por padrão
  app: { startWithWindows: true, closeToTray: true, gpu: false, language: 'pt-BR' }, // language: pt-BR | en | es
  ram: { enabled: false },
  exploreSources: [],
  pluginFolders: [],
  componentFolders: [],
  effectFolders: [],
  virtualDevices: false,
  wled: [], // controladoras de fita na rede: [{ host, name, ledCount }]
  screenPrevEffect: null, // efeito que tocava antes de ligar o Ambiente da Tela (volta a ele ao desligar)
  // papel de parede animado: o arquivo (dentro da biblioteca, src/main/library.js) que está na área de trabalho
  wallpaper: { enabled: false, file: null, fit: 'cover', pauseFullscreen: true, pauseMaximized: false },
  cooler: { enabled: true, image: null, rotation: 0, brightness: 100, fit: 'cover' } // tela do watercooler (image: arquivo da biblioteca)
});

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], extra[k]) : extra[k];
  }
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = DEFAULTS();
    try {
      if (fs.existsSync(this.file)) this.data = deepMerge(DEFAULTS(), JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (e) {
      try { fs.copyFileSync(this.file, this.file + '.corrompido'); } catch {}
      console.error('Falha ao ler config, usando padrões:', e.message);
    }
    this.timer = null;
  }

  get(keyPath) {
    if (!keyPath) return this.data;
    return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
      o = o[keys[i]];
    }
    if (value === undefined) delete o[keys[keys.length - 1]];
    else o[keys[keys.length - 1]] = value;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
