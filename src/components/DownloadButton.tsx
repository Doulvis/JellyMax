import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { BaseItem } from '../api/types';
import { downloadsSupported, enqueueDownloads, retryDownload, useDownloads, type DownloadEntry } from '../downloads/store';
import { t } from '../i18n';
import { Download, DownloadDone } from './Icons';

function entryLabel(e: DownloadEntry | undefined): string {
  if (!e) return t('dl.download');
  if (e.status === 'done') return t('dl.downloaded');
  if (e.status === 'queued') return t('dl.queued');
  if (e.status === 'error') return t('dl.failedShort');
  return e.total ? `${Math.min(99, Math.floor((e.received / e.total) * 100))} %` : t('dl.downloading');
}

/** Fiche complète (avec MediaSources) nécessaire au téléchargement et à la lecture hors connexion. */
async function fullItems(items: BaseItem[]): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (const it of items) out.push(it.MediaSources && it.MediaSources.length ? it : await api.item(it.Id));
  return out;
}

/** Film ou épisode : bouton rond « Télécharger » de la fiche détaillée. */
export function DownloadPill({ item }: { item: BaseItem }) {
  const list = useDownloads();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!downloadsSupported) return null;
  const e = list.find((x) => x.itemId === item.Id);
  const onClick = async () => {
    if (e) {
      if (e.status === 'error') retryDownload(e.key);
      else navigate('/downloads');
      return;
    }
    setBusy(true);
    try {
      enqueueDownloads(await fullItems([item]));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`icon-pill ${e && e.status === 'done' ? 'is-on' : ''}`} onClick={onClick} disabled={busy}>
      {e && e.status === 'done' ? <DownloadDone /> : <Download />}
      <span>{entryLabel(e)}</span>
    </button>
  );
}

/** Série : télécharge tous les épisodes de la saison affichée. */
export function SeasonDownloadPill({ episodes }: { episodes: BaseItem[] | null }) {
  const list = useDownloads();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!downloadsSupported || !episodes || !episodes.length) return null;
  const mine = episodes.map((ep) => list.find((x) => x.itemId === ep.Id));
  const doneCount = mine.filter((e) => e && e.status === 'done').length;
  const missing = episodes.filter((_, i) => !mine[i]);
  const all = doneCount === episodes.length;
  const label = all
    ? t('dl.seasonDone')
    : missing.length < episodes.length
      ? t('dl.seasonPartial', { n: episodes.length - missing.length, total: episodes.length })
      : t('dl.season');
  const onClick = async () => {
    if (!missing.length) {
      navigate('/downloads');
      return;
    }
    setBusy(true);
    try {
      enqueueDownloads(await fullItems(missing));
    } catch {
      /* serveur injoignable : rien n'est ajouté */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`icon-pill ${all ? 'is-on' : ''}`} onClick={onClick} disabled={busy}>
      {all ? <DownloadDone /> : <Download />}
      <span>{label}</span>
    </button>
  );
}

/** Ligne d'épisode : petit bouton rond à côté de « vu ». */
export function EpisodeDownloadButton({ ep }: { ep: BaseItem }) {
  const list = useDownloads();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!downloadsSupported) return null;
  const e = list.find((x) => x.itemId === ep.Id);
  const pct = e && e.status === 'downloading' && e.total ? Math.min(99, Math.floor((e.received / e.total) * 100)) : null;
  const onClick = async () => {
    if (e) {
      if (e.status === 'error') retryDownload(e.key);
      else navigate('/downloads');
      return;
    }
    setBusy(true);
    try {
      enqueueDownloads(await fullItems([ep]));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`ep__watched ep__dl ${e && e.status === 'done' ? 'is-on' : ''} ${e && e.status !== 'done' ? 'is-busy' : ''}`}
      onClick={onClick}
      disabled={busy}
      aria-label={entryLabel(e)}
      title={entryLabel(e)}
    >
      {pct != null ? <span className="ep__dl-pct">{pct}</span> : e && e.status === 'done' ? <DownloadDone /> : <Download />}
    </button>
  );
}
