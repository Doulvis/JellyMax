const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jellymax', {
  platform: 'electron',
  setPlaybackActive: (active) => ipcRenderer.send('playback-active', !!active),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
});
