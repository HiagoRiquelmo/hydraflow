'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = (channel, map = (_, x) => x) => cb => { const h = (...a) => cb(map(...a)); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };

contextBridge.exposeInMainWorld('api', {
  store: {
    get: () => ipcRenderer.invoke('store:get'),
    set: (keyPath, value) => ipcRenderer.send('store:set', keyPath, value)
  },
  effects: {
    list: () => ipcRenderer.invoke('effects:list'),
    read: id => ipcRenderer.invoke('effects:read', id),
    import: () => ipcRenderer.invoke('effects:import'),
    uninstall: id => ipcRenderer.invoke('effects:uninstall', id),
    openFolder: () => ipcRenderer.invoke('effects:openFolder'),
    saveThumb: (id, dataUrl) => ipcRenderer.invoke('effects:saveThumb', id, dataUrl)
  },
  explore: {
    list: refresh => ipcRenderer.invoke('explore:list', refresh),
    read: key => ipcRenderer.invoke('explore:read', key),
    install: key => ipcRenderer.invoke('explore:install', key),
    installMany: keys => ipcRenderer.invoke('explore:installMany', keys),
    addSource: url => ipcRenderer.invoke('explore:addSource', url),
    removeSource: url => ipcRenderer.invoke('explore:removeSource', url),
    deleteLocal: key => ipcRenderer.invoke('explore:deleteLocal', key)
  },
  ram: {
    status: () => ipcRenderer.invoke('ram:status'),
    enable: () => ipcRenderer.invoke('ram:enable'),
    onStatus: listen('ram:status')
  },
  onTray: listen('tray'),
  onBackground: listen('window:background', (_, bg) => !!bg),
  components: {
    list: () => ipcRenderer.invoke('components:list')
  },
  folders: {
    add: kind => ipcRenderer.invoke('folders:add', kind),
    remove: (kind, folder) => ipcRenderer.invoke('folders:remove', kind, folder),
    userDirs: () => ipcRenderer.invoke('folders:userDirs')
  },
  system: {
    conflicts: () => ipcRenderer.invoke('system:conflicts')
  },
  engine: {
    frame: payload => ipcRenderer.send('engine:frame', payload),
    snapshot: () => ipcRenderer.invoke('engine:snapshot'),
    cmd: (type, payload) => ipcRenderer.send('engine:cmd', type, payload),
    on: listen('engine')
  },
  shell: {
    showItem: p => ipcRenderer.invoke('shell:showItem', p)
  },
  screen: {
    source: () => ipcRenderer.invoke('screen:source'), // id da tela principal para o Ambiente da Tela
    startNative: fps => ipcRenderer.invoke('screen:nativeStart', fps), // captura DXGI: { ok, w, h } ou { ok:false, error }
    stopNative: () => ipcRenderer.invoke('screen:nativeStop'),
    onFrame: listen('screen:frame'),       // { w, h, data: Uint8Array RGBA }
    onNativeStatus: listen('screen:nativeStatus')
  },
  cooler: {
    status: () => ipcRenderer.invoke('cooler:status'),
    set: patch => ipcRenderer.invoke('cooler:set', patch), // { item } escolhe uma imagem da biblioteca
    onImageCleared: listen('cooler:imageCleared'),          // a imagem em uso foi excluída da biblioteca
    frame: jpeg => ipcRenderer.invoke('cooler:frame', jpeg), // ArrayBuffer com um JPEG do tamanho da tela
    imageData: () => ipcRenderer.invoke('cooler:imageData'),
    ready: () => ipcRenderer.invoke('cooler:ready'),
    onState: listen('cooler:state')
  },
  wled: {
    probe: host => ipcRenderer.invoke('wled:probe', host),
    set: list => ipcRenderer.invoke('wled:set', list)
  },
  wallpaper: {
    get: () => ipcRenderer.invoke('wallpaper:get'),
    set: patch => ipcRenderer.invoke('wallpaper:set', patch), // { item } escolhe um arquivo da biblioteca
    onStatus: listen('wallpaper:status')
  },
  // biblioteca de mídia (src/main/library.js): { items, totalBytes, usage } em todas as respostas
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    import: onlyImages => ipcRenderer.invoke('library:import', !!onlyImages),
    importPaths: paths => ipcRenderer.invoke('library:importPaths', paths),
    remove: (id, force) => ipcRenderer.invoke('library:remove', id, !!force),
    rename: (id, name) => ipcRenderer.invoke('library:rename', id, name),
    thumb: id => ipcRenderer.invoke('library:thumb', id), // URL da miniatura (gera se faltar)
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    /** Caminho no disco de um arquivo arrastado para a janela (File do evento de soltar). */
    pathForFile: file => webUtils.getPathForFile(file)
  },
  i18n: {
    get: () => ipcRenderer.invoke('i18n:get'),     // { lang, dict, base, langs }
    set: lang => ipcRenderer.invoke('i18n:set', lang)
  },
  relaunch: () => ipcRenderer.invoke('app:relaunch')
});
