const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Identifiant Windows : regroupement correct dans la barre des tâches et les notifications.
app.setAppUserModelId('app.jellymax.desktop');

// ---- Mémorisation de la taille / position de la fenêtre ----
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const fallback = { width: 1440, height: 900, maximized: false };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // On vérifie que la fenêtre reste visible sur un des écrans actuels.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width - 100 && s.y < a.y + a.height - 100;
    });
    return visible ? { ...fallback, ...s } : { ...fallback, maximized: !!s.maximized };
  } catch {
    return fallback;
  }
}

function saveWindowState(w) {
  try {
    const b = w.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: w.isMaximized() }));
  } catch {
    /* ignore */
  }
}

// Lecture automatique sans geste utilisateur + décodage HEVC matériel quand le GPU le permet.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let blockerId = null;

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'JellyMax',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 40 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  win.on('close', () => saveWindowState(win));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Liens externes (bandes-annonces…) dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url.split('#')[0] !== current.split('#')[0]) event.preventDefault();
  });

  // Stabilité : si le moteur de rendu plante, on recharge l'interface.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) win.reload();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

ipcMain.on('playback-active', (_e, active) => {
  if (active && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!active && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
});

ipcMain.on('toggle-fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});

// ---- Google Cast (voir cast.cjs) ----
let castDevices = [];
let stopCastDiscovery = null;
let castSession = null;

function sendToWin(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

ipcMain.on('cast-discover', (_e, on) => {
  if (on && !stopCastDiscovery) {
    stopCastDiscovery = discover((list) => {
      castDevices = list;
      sendToWin('cast-devices', list);
    });
    sendToWin('cast-devices', castDevices);
  } else if (!on && stopCastDiscovery) {
    stopCastDiscovery();
    stopCastDiscovery = null;
  }
});
ipcMain.handle('cast-connect', async (_e, id) => {
  const device = castDevices.find((d) => d.id === id);
  if (!device) throw new Error('Appareil introuvable');
  if (castSession) await castSession.stop();
  const s = new CastSession(device);
  castSession = s;
  s.on('status', (st) => {
    if (castSession !== s) return;
    if (!st.connected) castSession = null;
    sendToWin('cast-status', st);
  });
  try {
    await s.start();
  } catch (e) {
    s.finish();
    throw e;
  }
  return { id: device.id, name: device.name };
});
ipcMain.handle('cast-load', (_e, media) => {
  if (!castSession) throw new Error('Aucun appareil Cast connecté');
  return castSession.load(media);
});
ipcMain.on('cast-control', (_e, cmd) => {
  if (castSession) castSession.control(cmd);
});
ipcMain.handle('cast-disconnect', () => (castSession ? castSession.stop() : undefined));
// Après un rechargement de la page : session encore active ?
ipcMain.handle('cast-current', () => (castSession ? { id: castSession.device.id, name: castSession.device.name } : null));

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // Filet de sécurité CORS : si un proxy devant Jellyfin ne renvoie pas d'en-tête CORS,
  // on l'ajoute pour que l'application (servie en file://) puisse dialoguer avec le serveur.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    const has = Object.keys(headers).some((k) => k.toLowerCase() === 'access-control-allow-origin');
    if (!has && /^https?:/i.test(details.url)) {
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, DELETE, OPTIONS'];
    }
    callback({ responseHeaders: headers });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (castSession) castSession.stop();
  app.quit();
});
