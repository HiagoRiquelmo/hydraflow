'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wallpaper', {
  onPause: cb => ipcRenderer.on('pause', (_, p) => cb(!!p)),
  size: (w, h) => ipcRenderer.send('size', { w, h }) // pixels reais que a página recebeu
});
