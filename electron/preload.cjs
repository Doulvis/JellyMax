const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jellymax', {
  platform: 'electron',
  setPlaybackActive: (active) => ipcRenderer.send('playback-active', !!active),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  cast: {
    discover: (on) => ipcRenderer.send('cast-discover', !!on),
    connect: (id) => ipcRenderer.invoke('cast-connect', id),
    load: (media) => ipcRenderer.invoke('cast-load', media),
    control: (cmd) => ipcRenderer.send('cast-control', cmd),
    disconnect: () => ipcRenderer.invoke('cast-disconnect'),
    current: () => ipcRenderer.invoke('cast-current'),
    onDevices: (cb) => {
      const handler = (_e, list) => cb(list);
      ipcRenderer.on('cast-devices', handler);
      return () => ipcRenderer.removeListener('cast-devices', handler);
    },
    onStatus: (cb) => {
      const handler = (_e, s) => cb(s);
      ipcRenderer.on('cast-status', handler);
      return () => ipcRenderer.removeListener('cast-status', handler);
    },
  },
  downloads: {
    start: (job) => ipcRenderer.invoke('dl-start', job),
    cancel: (key) => ipcRenderer.invoke('dl-cancel', key),
    remove: (file) => ipcRenderer.invoke('dl-remove', file),
    exists: (file) => ipcRenderer.invoke('dl-exists', file),
    fileUrl: (file) => ipcRenderer.invoke('dl-url', file),
    openFolder: () => ipcRenderer.invoke('dl-open-folder'),
    onProgress: (cb) => {
      const handler = (_e, p) => cb(p);
      ipcRenderer.on('dl-progress', handler);
      return () => ipcRenderer.removeListener('dl-progress', handler);
    },
  },
});
