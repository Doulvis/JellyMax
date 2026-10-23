// Intégration Android (Capacitor) : chargée uniquement dans le build `--mode android`.
import { App } from '@capacitor/app';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { setCastBackend, type CastCommand, type CastDevice, type CastMedia, type CastStatus } from './cast/cast';
import { native } from './platform';

/** Plugin natif de l'application (android/app/src/main/java/app/jellymax/mobile/JellyMaxSystemPlugin.java). */
interface JellyMaxSystem {
  setPlayback(options: { active: boolean }): Promise<void>;
  download(options: { url: string; fileName: string; title: string }): Promise<{ id: string; file: string }>;
  downloadStatus(options: { ids: string[] }): Promise<{
    items: { id: string; state: 'progressing' | 'completed' | 'failed'; received: number; total: number }[];
  }>;
  removeDownload(options: { id?: string; file?: string }): Promise<void>;
  downloadExists(options: { file: string }): Promise<{ exists: boolean }>;
  downloadUrl(options: { file: string }): Promise<{ url: string }>;
}
const system = registerPlugin<JellyMaxSystem>('JellyMaxSystem');

/** Google Cast (android/app/src/main/java/app/jellymax/mobile/JellyMaxCastPlugin.java). */
interface JellyMaxCast {
  isAvailable(): Promise<{ available: boolean; connected?: string }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(options: { id: string }): Promise<{ name: string }>;
  load(media: CastMedia): Promise<void>;
  control(cmd: CastCommand): Promise<void>;
  disconnect(): Promise<void>;
  addListener(event: 'devices', cb: (r: { devices: CastDevice[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', cb: (s: CastStatus) => void): Promise<PluginListenerHandle>;
}
const cast = registerPlugin<JellyMaxCast>('JellyMaxCast');

function initCast() {
  cast
    .isAvailable()
    .then((r) => {
      if (!r.available) return; // pas de services Google Play
      setCastBackend({
        discover(onDevices) {
          const handle = cast.addListener('devices', (d) => onDevices(d.devices || []));
          cast.startDiscovery().catch(() => {});
          return () => {
            handle.then((h) => h.remove());
            cast.stopDiscovery().catch(() => {});
          };
        },
        connect: (id) => cast.connect({ id }),
        load: (media) => cast.load(media),
        control: (cmd) => {
          cast.control(cmd).catch(() => {});
        },
        disconnect: () => cast.disconnect(),
        onStatus: (cb) => {
          cast.addListener('status', cb);
        },
        current: () => cast.isAvailable().then((s) => s.connected || null),
      });
    })
    .catch(() => {});
}

export function initAndroid() {
  initCast();
  native.setPlayback = (active) => {
    system.setPlayback({ active }).catch(() => {});
  };
  native.exit = () => {
    App.exitApp().catch(() => {});
  };
  native.downloads = {
    start: (url, fileName, title) => system.download({ url, fileName, title }),
    status: (ids) => system.downloadStatus({ ids }).then((r) => r.items || []),
    remove: (id, file) => system.removeDownload({ id, file }),
    exists: (file) => system.downloadExists({ file }).then((r) => !!r.exists),
    fileUrl: (file) => system.downloadUrl({ file }).then((r) => r.url),
  };

  // Bouton "Retour" d'Android : transmis comme la touche "Précédent" d'un clavier, déjà gérée partout
  // (fermeture des menus et panneaux, sortie du lecteur, page précédente, sortie de l'application).
  App.addListener('backButton', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true, cancelable: true }));
  });
}
