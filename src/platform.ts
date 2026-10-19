// Couche plateforme : Windows (Electron), TV Samsung (Tizen) et navigateur pour le développement.

interface JellyMaxBridge {
  platform: 'electron';
  setPlaybackActive(active: boolean): void;
  toggleFullscreen(): void;
}

// Sous-ensemble des API Tizen / Samsung utilisées par l'application.
interface TizenApi {
  tvinputdevice?: { registerKeyBatch?(keys: string[]): void; registerKey?(key: string): void };
  application?: { getCurrentApplication(): { exit(): void } };
}
interface SamsungWebApis {
  appcommon?: {
    setScreenSaver(state: number, onSuccess?: () => void, onError?: () => void): void;
    AppCommonScreenSaverState?: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
  };
}

declare global {
  interface Window {
    jellymax?: JellyMaxBridge;
    tizen?: TizenApi;
    webapis?: SamsungWebApis;
  }
}

export const APP_NAME = 'JellyMax';
export const APP_VERSION = '1.0.0';

export const isElectron = typeof window !== 'undefined' && !!window.jellymax;
/** Application installée sur une TV Samsung (API Tizen disponibles). */
export const isTizen = typeof window !== 'undefined' && (!!window.tizen || /Tizen/i.test(navigator.userAgent));
/** Interface TV (télécommande, pas de souris) : build Tizen ou TV Tizen détectée. */
export const isTV = import.meta.env.MODE === 'tizen' || isTizen;

export const deviceName = isElectron ? 'JellyMax Windows' : isTV ? 'JellyMax Samsung TV' : 'JellyMax Web';
export const platformLabel = isElectron ? 'Windows' : isTV ? 'Samsung TV (Tizen)' : 'Web';

// Touches de la télécommande à demander explicitement au système (sinon elles ne sont pas transmises).
const TV_KEYS = [
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaFastForward',
  'MediaRewind',
  'MediaTrackNext',
  'MediaTrackPrevious',
];

// Codes des touches de la télécommande Samsung, certaines n'ayant pas de valeur `key` standard.
const TV_KEY_CODES: Record<number, string> = {
  10009: 'Back',
  10182: 'Exit',
  415: 'MediaPlay',
  19: 'MediaPause',
  10252: 'MediaPlayPause',
  413: 'MediaStop',
  417: 'MediaFastForward',
  412: 'MediaRewind',
  10233: 'MediaTrackNext',
  10232: 'MediaTrackPrevious',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  13: 'Enter',
};

/** Nom normalisé d'une touche (clavier ou télécommande). */
export function keyName(e: KeyboardEvent): string {
  if (isTV) {
    const mapped = TV_KEY_CODES[e.keyCode];
    if (mapped) return mapped;
    if (e.key === 'XF86Back') return 'Back';
  }
  return e.key;
}

export function initPlatform() {
  const root = document.documentElement;
  if (isElectron) root.classList.add('is-electron');
  if (isTV) {
    root.classList.add('is-tv', 'kbd-nav');
    try {
      const input = window.tizen && window.tizen.tvinputdevice;
      if (input && input.registerKeyBatch) input.registerKeyBatch(TV_KEYS);
      else if (input && input.registerKey) TV_KEYS.forEach((k) => input.registerKey!(k));
    } catch {
      /* touches non disponibles sur ce modèle */
    }
  }
  if (!supportsFlexGap()) root.classList.add('no-flex-gap');
}

/** Les TV antérieures à 2022 (Chromium < 84) ignorent `gap` dans les conteneurs flex. */
function supportsFlexGap() {
  const flex = document.createElement('div');
  flex.style.display = 'flex';
  flex.style.flexDirection = 'column';
  flex.style.rowGap = '1px';
  flex.appendChild(document.createElement('div'));
  flex.appendChild(document.createElement('div'));
  document.body.appendChild(flex);
  const ok = flex.scrollHeight === 1;
  document.body.removeChild(flex);
  return ok;
}

/** Touche "Précédent" : clavier multimédia, souris ou télécommande. */
export function isBackKey(e: KeyboardEvent) {
  const k = keyName(e);
  return k === 'Back' || k === 'BrowserBack' || k === 'GoBack';
}

/** Ferme l'application (TV uniquement). */
export function exitApp() {
  try {
    if (window.tizen && window.tizen.application) window.tizen.application.getCurrentApplication().exit();
  } catch {
    /* ignore */
  }
}

/** Empêche la mise en veille de l'écran pendant la lecture. */
export function setPlaybackActive(active: boolean) {
  try {
    window.jellymax?.setPlaybackActive(active);
  } catch {
    /* ignore */
  }
  try {
    const common = window.webapis && window.webapis.appcommon;
    if (common && common.AppCommonScreenSaverState) {
      const s = common.AppCommonScreenSaverState;
      common.setScreenSaver(active ? s.SCREEN_SAVER_OFF : s.SCREEN_SAVER_ON);
    }
  } catch {
    /* ignore */
  }
}
