// Couche plateforme : intégration Windows (Electron), avec repli sur un navigateur pour le développement.

interface JellyMaxBridge {
  platform: 'electron';
  setPlaybackActive(active: boolean): void;
  toggleFullscreen(): void;
}

declare global {
  interface Window {
    jellymax?: JellyMaxBridge;
  }
}

export const APP_NAME = 'JellyMax';
export const APP_VERSION = '1.0.0';

export const isElectron = typeof window !== 'undefined' && !!window.jellymax;

export const deviceName = isElectron ? 'JellyMax Windows' : 'JellyMax Web';
export const platformLabel = isElectron ? 'Windows' : 'Web';

export function initPlatform() {
  if (isElectron) document.documentElement.classList.add('is-electron');
}

/** Touche "Précédent" d'un clavier multimédia ou d'une souris. */
export function isBackKey(e: KeyboardEvent) {
  return e.key === 'BrowserBack' || e.key === 'GoBack';
}

/** Empêche la mise en veille de l'écran pendant la lecture. */
export function setPlaybackActive(active: boolean) {
  try {
    window.jellymax?.setPlaybackActive(active);
  } catch {
    /* ignore */
  }
}
