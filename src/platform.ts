// Couche plateforme : Windows (Electron), TV Samsung (Tizen) et navigateur pour le développement.

import type { CastCommand, CastDevice, CastMedia, CastStatus } from './cast/cast';

/** Progression d'un téléchargement envoyée par la couche Windows. */
export interface NativeDownloadProgress {
  key: string;
  state: 'progressing' | 'completed' | 'failed' | 'cancelled';
  received: number;
  total: number;
  file: string;
}

interface JellyMaxBridge {
  platform: 'electron';
  setPlaybackActive(active: boolean): void;
  toggleFullscreen(): void;
  /** Google Cast (electron/cast.cjs). */
  cast?: {
    discover(on: boolean): void;
    connect(id: string): Promise<{ id: string; name: string }>;
    load(media: CastMedia): Promise<void>;
    control(cmd: CastCommand): void;
    disconnect(): Promise<void>;
    current(): Promise<{ id: string; name: string } | null>;
    onDevices(cb: (list: CastDevice[]) => void): () => void;
    onStatus(cb: (s: CastStatus) => void): () => void;
  };
  downloads?: {
    start(job: { key: string; url: string; fileName: string }): Promise<{ file: string }>;
    cancel(key: string): Promise<void>;
    remove(file: string): Promise<void>;
    exists(file: string): Promise<boolean>;
    fileUrl(file: string): Promise<string>;
    openFolder(): Promise<string>;
    onProgress(cb: (p: NativeDownloadProgress) => void): () => void;
  };
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
    /** Origine du code chargé, renseignée par le chargeur d'index.html (scripts/vite-remote.mjs). */
    __JM_SOURCE__?: { from: 'server' | 'local'; version: string };
    tizen?: TizenApi;
    webapis?: SamsungWebApis;
  }
}

export const APP_NAME = 'JellyMax';
/** Version de package.json, au format court (1.0.0 → 1.0) : celle du code chargé, éventuellement depuis le serveur de mises à jour. */
export const APP_VERSION = __APP_VERSION__.replace(/\.0$/, '');

export const isElectron = typeof window !== 'undefined' && !!window.jellymax;
/** Application installée sur une TV Samsung (API Tizen disponibles). */
export const isTizen = typeof window !== 'undefined' && (!!window.tizen || /Tizen/i.test(navigator.userAgent));
/** Interface TV (télécommande, pas de souris) : build Tizen ou TV Tizen détectée. */
export const isTV = import.meta.env.MODE === 'tizen' || isTizen;

/** Application Android (téléphone ou tablette), construite avec `vite build --mode android`. */
export const isAndroid = import.meta.env.MODE === 'android';
/** Interface tactile : barre d'onglets en bas, lecteur tactile, pas de survol. */
export const isMobile = isAndroid;
const isTablet = isAndroid && Math.min(screen.width, screen.height) >= 600;

export const deviceName = isElectron
  ? 'JellyMax Windows'
  : isTV
    ? 'JellyMax Samsung TV'
    : isAndroid
      ? isTablet
        ? 'JellyMax Android Tablet'
        : 'JellyMax Android'
      : 'JellyMax Web';
export const platformLabel = isElectron ? 'Windows' : isTV ? 'Samsung TV (Tizen)' : isAndroid ? 'Android' : 'Web';

/** Fonctions natives fournies par la couche Android (src/android.ts), chargée uniquement dans ce build. */
export const native: {
  setPlayback?: (active: boolean) => void;
  exit?: () => void;
  /** Téléchargements Android (gestionnaire de téléchargements du système). */
  downloads?: {
    start(url: string, fileName: string, title: string): Promise<{ id: string; file: string }>;
    status(ids: string[]): Promise<{ id: string; state: 'progressing' | 'completed' | 'failed'; received: number; total: number }[]>;
    remove(id: string | undefined, file: string | undefined): Promise<void>;
    exists(file: string): Promise<boolean>;
    fileUrl(file: string): Promise<string>;
  };
} = {};

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
  if (isMobile) root.classList.add('is-mobile');
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

/** Ferme l'application (TV et Android). */
export function exitApp() {
  if (native.exit) {
    native.exit();
    return;
  }
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
    // Android : écran allumé, plein écran immersif et paysage pendant la lecture.
    if (native.setPlayback) native.setPlayback(active);
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
