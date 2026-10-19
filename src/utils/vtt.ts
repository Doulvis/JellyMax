// Analyse WebVTT minimaliste : les sous-titres sont rendus par l'appli pour un style uniforme.

export interface Cue {
  start: number;
  end: number;
  html: string;
}

function parseTimestamp(s: string): number {
  const m = s.match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!m) return NaN;
  return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / Math.pow(10, m[4].length);
}

/** Ne garde que <i>, <b>, <u> et échappe tout le reste. */
export function sanitizeCue(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<(\/?)(i|b|u)>/gi, '\u0001$1$2\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u0001/g, '<')
    .replace(/\u0002/g, '>')
    .replace(/&amp;(nbsp|amp|lt|gt);/g, '&$1;');
}

export function parseVtt(src: string): Cue[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('-->') < 0) continue;
    const parts = line.split('-->');
    const start = parseTimestamp(parts[0].trim());
    const end = parseTimestamp(parts[1].trim().split(/\s+/)[0]);
    const text: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== '') {
      text.push(lines[i]);
      i++;
    }
    if (!isNaN(start) && !isNaN(end) && text.length) cues.push({ start, end, html: sanitizeCue(text.join('\n')) });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** Texte actif à l'instant t (gère les répliques qui se chevauchent). */
export function activeCueHtml(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: string[] = [];
  for (let i = idx; i >= 0 && i > idx - 6; i--) {
    if (cues[i].end > t) out.unshift(cues[i].html);
  }
  return out.join('\n');
}
