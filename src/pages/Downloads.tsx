import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { landscapeUrl } from '../api/images';
import { Empty } from '../components/Common';
import { Close, Download, Folder, Play, Restart, Trash } from '../components/Icons';
import { loadImage } from '../downloads/images';
import {
  cancelDownload,
  deleteDownload,
  openDownloadFolder,
  pump,
  retryDownload,
  useDownloads,
  type DownloadEntry,
} from '../downloads/store';
import { locale, t } from '../i18n';
import { isElectron } from '../platform';
import { episodeCode, formatRuntime, TPS } from '../utils/format';

export function formatBytes(n: number) {
  if (!n) return '0 Mo';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${t('dl.gb')}`;
  return `${Math.max(1, Math.round(n / 1024 ** 2)).toLocaleString(locale())} ${t('dl.mb')}`;
}

/** Image enregistrée avec le téléchargement (hors connexion), sinon celle du serveur. */
function useThumb(e: DownloadEntry) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    loadImage(e.key).then((blob) => {
      if (!alive) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } else setUrl(landscapeUrl(e.item, 480));
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [e.key, e.item]);
  return url;
}

function DownloadRow({ e }: { e: DownloadEntry }) {
  const navigate = useNavigate();
  const thumb = useThumb(e);
  const [confirm, setConfirm] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirm]);

  const it = e.item;
  const title = it.Type === 'Episode' ? it.SeriesName || it.Name : it.Name;
  const sub =
    it.Type === 'Episode'
      ? [episodeCode(it), it.Name].filter(Boolean).join(' · ')
      : [it.ProductionYear, formatRuntime(it.RunTimeTicks)].filter(Boolean).join(' · ');
  const pct = e.total > 0 ? Math.min(100, Math.round((e.received / e.total) * 100)) : 0;
  const runtime = it.RunTimeTicks ? it.RunTimeTicks / TPS : 0;
  const watched = e.position && runtime ? Math.min(100, (e.position / runtime) * 100) : 0;
  const play = () => navigate(`/play/${e.itemId}?offline=1`);

  let status: string;
  if (e.status === 'done') status = formatBytes(e.total);
  else if (e.status === 'queued') status = t('dl.queued');
  else if (e.status === 'error') status = e.error || t('dl.err.interrupted');
  else status = e.total ? t('dl.progress', { pct, done: formatBytes(e.received), total: formatBytes(e.total) }) : formatBytes(e.received);

  return (
    <div className={`dl-row dl-row--${e.status}`}>
      <button className="dl-row__thumb" onClick={play} disabled={e.status !== 'done'} tabIndex={e.status === 'done' ? 0 : -1}>
        {thumb && !imgFailed ? <img src={thumb} alt="" onError={() => setImgFailed(true)} /> : <span>{title}</span>}
        {e.status === 'done' && (
          <span className="dl-row__play">
            <Play />
          </span>
        )}
        {watched > 0 && watched < 100 && (
          <div className="card__progress">
            <span style={{ width: `${watched}%` }} />
          </div>
        )}
      </button>
      <div className="dl-row__info">
        <div className="dl-row__title">{title}</div>
        {sub && <div className="dl-row__sub">{sub}</div>}
        <div className="dl-row__status">{status}</div>
        {(e.status === 'downloading' || e.status === 'queued') && (
          <div className="dl-row__bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="dl-row__actions">
        {e.status === 'error' && (
          <button className="dl-btn" onClick={() => retryDownload(e.key)} aria-label={t('common.retry')} title={t('common.retry')}>
            <Restart />
          </button>
        )}
        {e.status === 'done' || e.status === 'error' ? (
          <button
            className={`dl-btn ${confirm ? 'is-danger' : ''}`}
            onClick={() => (confirm ? deleteDownload(e.key) : setConfirm(true))}
            aria-label={t('dl.delete')}
            title={t('dl.delete')}
          >
            <Trash />
            {confirm && <span>{t('dl.confirmDelete')}</span>}
          </button>
        ) : (
          <button className="dl-btn" onClick={() => cancelDownload(e.key)} aria-label={t('common.cancel')} title={t('common.cancel')}>
            <Close />
          </button>
        )}
      </div>
    </div>
  );
}

export default function DownloadsPage() {
  const list = useDownloads();

  // Reprend la file d'attente (par ex. après un redémarrage hors connexion puis de retour en ligne).
  useEffect(() => {
    pump();
  }, []);

  const active = list.filter((e) => e.status === 'downloading' || e.status === 'queued');
  const done = list.filter((e) => e.status === 'done').sort((a, b) => b.addedAt - a.addedAt);
  const failed = list.filter((e) => e.status === 'error');
  const size = done.reduce((n, e) => n + (e.total || 0), 0);

  return (
    <div className="page-flush downloads">
      <div className="page-head page-head--row">
        <div>
          <h1 className="page__title">{t('nav.downloads')}</h1>
          {done.length > 0 && (
            <p className="page__sub">
              {done.length === 1 ? t('dl.count1') : t('dl.countN', { n: done.length })} · {formatBytes(size)}
            </p>
          )}
        </div>
        {isElectron && (
          <button className="btn btn--ghost btn--sm" onClick={openDownloadFolder}>
            <Folder /> {t('dl.openFolder')}
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <Empty>
          <span className="dl-empty">
            <Download />
            <strong>{t('dl.emptyTitle')}</strong>
            {t('dl.emptyText')}
          </span>
        </Empty>
      ) : (
        <div className="downloads__body">
          {active.length > 0 && (
            <section className="dl-section">
              <h2 className="section-title">{t('dl.inProgress')}</h2>
              {active.map((e) => (
                <DownloadRow key={e.key} e={e} />
              ))}
            </section>
          )}
          {failed.length > 0 && (
            <section className="dl-section">
              <h2 className="section-title">{t('dl.failed')}</h2>
              {failed.map((e) => (
                <DownloadRow key={e.key} e={e} />
              ))}
            </section>
          )}
          {done.length > 0 && (
            <section className="dl-section">
              <h2 className="section-title">{t('dl.available')}</h2>
              {done.map((e) => (
                <DownloadRow key={e.key} e={e} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
