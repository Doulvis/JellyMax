import type { CSSProperties } from 'react';
import type { Settings } from '../state/settings';

const SIZES = { small: 1.7, medium: 2.3, large: 2.9, xlarge: 3.6 };
export const SUBTITLE_COLORS = {
  white: '#ffffff',
  yellow: '#ffe14d',
  cyan: '#5fe3ff',
  green: '#7dff8a',
  magenta: '#ff7ce5',
};
const BACKGROUNDS = { none: 'transparent', translucent: 'rgba(0, 0, 0, 0.55)', opaque: 'rgba(0, 0, 0, 0.9)' };
const EDGES = {
  shadow: '0 0 4px #000, 0 2px 6px #000, 0 0 2px #000',
  outline: '-0.06em -0.06em 0 #000, 0.06em -0.06em 0 #000, -0.06em 0.06em 0 #000, 0.06em 0.06em 0 #000, 0 0 0.1em #000',
  none: 'none',
};
const POSITIONS = { low: 4, medium: 8, high: 16 };
const FONTS = {
  sans: "'Inter', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

/** Variables CSS appliquées aux sous-titres (lecteur et aperçu des paramètres). */
export function subtitleVars(s: Settings): CSSProperties {
  return {
    '--sub-size': String(SIZES[s.subtitleSize] || SIZES.medium),
    '--sub-color': SUBTITLE_COLORS[s.subtitleColor] || '#fff',
    '--sub-bg': BACKGROUNDS[s.subtitleBackground] || 'transparent',
    '--sub-shadow': EDGES[s.subtitleEdge] || EDGES.shadow,
    '--sub-bottom': `${POSITIONS[s.subtitlePosition] || 8}%`,
    '--sub-font': FONTS[s.subtitleFont] || FONTS.sans,
  } as CSSProperties;
}
