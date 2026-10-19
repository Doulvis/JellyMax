import { useSyncExternalStore } from 'react';

export type Language = 'fr' | 'en';
export type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = 'white' | 'yellow' | 'cyan' | 'green' | 'magenta';
export type SubtitleBackground = 'none' | 'translucent' | 'opaque';
export type SubtitleEdge = 'shadow' | 'outline' | 'none';
export type SubtitlePosition = 'low' | 'medium' | 'high';
export type SubtitleFont = 'sans' | 'serif';

export interface Settings {
  language: Language;
  /** Ouvre directement le dernier profil utilisé au lieu de l'écran "Qui regarde ?". */
  skipProfilePicker: boolean;
  maxBitrate: number;
  autoplayNext: boolean;
  autoSkipIntro: boolean;
  subtitleSize: SubtitleSize;
  subtitleColor: SubtitleColor;
  subtitleBackground: SubtitleBackground;
  subtitleEdge: SubtitleEdge;
  subtitlePosition: SubtitlePosition;
  subtitleFont: SubtitleFont;
  volume: number;
  muted: boolean;
}

/** Débits proposés (les libellés sont traduits dans i18n.ts). */
export const BITRATE_VALUES = [120_000_000, 60_000_000, 20_000_000, 10_000_000, 6_000_000, 3_000_000, 1_500_000];

export const SUBTITLE_DEFAULTS = {
  subtitleSize: 'medium' as SubtitleSize,
  subtitleColor: 'white' as SubtitleColor,
  subtitleBackground: 'none' as SubtitleBackground,
  subtitleEdge: 'shadow' as SubtitleEdge,
  subtitlePosition: 'medium' as SubtitlePosition,
  subtitleFont: 'sans' as SubtitleFont,
};

const KEY = 'jm.settings';

function defaultLanguage(): Language {
  try {
    return (navigator.language || 'fr').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en';
  } catch {
    return 'fr';
  }
}

const defaults: Settings = {
  language: defaultLanguage(),
  skipProfilePicker: false,
  maxBitrate: 120_000_000,
  autoplayNext: true,
  autoSkipIntro: false,
  ...SUBTITLE_DEFAULTS,
  volume: 1,
  muted: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Ancienne version : le fond des sous-titres était un simple booléen.
      if (typeof saved.subtitleBackground === 'boolean') {
        saved.subtitleBackground = saved.subtitleBackground ? 'translucent' : 'none';
      }
      return { ...defaults, ...saved };
    }
  } catch {
    /* ignore */
  }
  return { ...defaults };
}

let state = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
