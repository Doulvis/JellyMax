import { ApiError } from '../api/client';
import type { BaseItem } from '../api/types';
import { locale, t } from '../i18n';

export const TPS = 10_000_000; // ticks par seconde

const pad = (n: number) => (n < 10 ? '0' : '') + n;

export function formatClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return t('time.min', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t('time.hm', { h, m }) : t('time.h', { h });
}

export function formatRuntime(ticks?: number): string {
  if (!ticks) return '';
  return formatMinutes(Math.max(1, Math.round(ticks / TPS / 60)));
}

export function remainingLabel(item: BaseItem): string {
  const rt = item.RunTimeTicks;
  const pos = item.UserData && item.UserData.PlaybackPositionTicks;
  if (!rt || !pos) return '';
  const min = Math.max(1, Math.round((rt - pos) / TPS / 60));
  return t('time.remaining', { t: formatMinutes(min) });
}

export function episodeCode(item: BaseItem): string {
  if (item.ParentIndexNumber == null && item.IndexNumber == null) return '';
  return t('ep.code', { s: item.ParentIndexNumber ?? 0, e: item.IndexNumber ?? 0 });
}

export function yearLabel(item: BaseItem): string {
  if (item.Type === 'Series' && item.ProductionYear) {
    if (item.Status === 'Continuing') return `${item.ProductionYear} –`;
    const end = item.EndDate ? new Date(item.EndDate).getFullYear() : null;
    if (end && end !== item.ProductionYear) return `${item.ProductionYear} – ${end}`;
  }
  return item.ProductionYear ? String(item.ProductionYear) : '';
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

export function qualityBadge(item: BaseItem): string[] {
  const streams = item.MediaStreams || (item.MediaSources && item.MediaSources[0] && item.MediaSources[0].MediaStreams) || [];
  const video = streams.find((s) => s.Type === 'Video');
  const out: string[] = [];
  if (video && video.Width) {
    if (video.Width >= 3800) out.push('4K');
    else if (video.Width >= 1260) out.push('HD');
  }
  const range = (video && (video.VideoRangeType || video.VideoRange)) || '';
  if (/DOVI/i.test(range)) out.push('Dolby Vision');
  else if (/HDR|HLG/i.test(range)) out.push('HDR');
  return out;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.status === 401) return t('err.session');
    if (e.status === 403) return t('err.forbidden');
    if (e.status === 404) return t('err.notFound');
    if (e.status >= 500) return t('err.server', { n: e.status });
    return t('err.generic', { n: e.status });
  }
  if (e instanceof Error) return e.message;
  return t('err.unknown');
}

/** Comme Promise.allSettled mais par promesse : renvoie null en cas d'échec. */
export function settle<T>(p: Promise<T>): Promise<T | null> {
  return p.then(
    (v) => v,
    () => null,
  );
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
