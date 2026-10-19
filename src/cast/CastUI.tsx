// Interface Google Cast : choix de l'appareil (lecteur) et mini-barre de lecture (reste de l'application).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { landscapeUrl } from '../api/images';
import { Spinner } from '../components/Common';
import * as I from '../components/Icons';
import { t } from '../i18n';
import { episodeCode, errorMessage } from '../utils/format';
import { castTogglePlay, disconnectDevice, discoverDevices, useCast, type CastDevice } from './cast';

export function CastPicker({
  onPick,
  onDisconnect,
  onClose,
}: {
  onPick(device: CastDevice): Promise<void>;
  onDisconnect(): void;
  onClose(): void;
}) {
  const cast = useCast();
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  const connected = !!cast.device;

  useEffect(() => {
    if (connected) return;
    const stop = discoverDevices(setDevices);
    const timer = window.setTimeout(() => setWaited(true), 8000);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [connected]);

  const pick = async (d: CastDevice) => {
    setBusy(d.id);
    setError(null);
    try {
      await onPick(d);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ppanel ppanel--cast" data-nav-scope>
      <div className="ppanel__head">
        <h3>{t('cast.title')}</h3>
        <button className="pbtn" onClick={onClose} aria-label={t('common.close')}>
          <I.Close />
        </button>
      </div>
      {cast.device ? (
        <div className="castpick__connected">
          <div className="castpick__device is-active">
            <I.Cast />
            <span>{t('cast.connectedTo', { name: cast.device.name })}</span>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onDisconnect} autoFocus>
            {t('cast.disconnect')}
          </button>
        </div>
      ) : (
        <div className="ppanel__list">
          {devices.map((d) => (
            <button key={d.id} className="ppanel__opt castpick__device" onClick={() => pick(d)} disabled={!!busy}>
              <span className="ppanel__check">{busy === d.id ? <Spinner size="sm" /> : <I.Cast />}</span>
              <span>
                {d.name}
                {d.model && <small> · {d.model}</small>}
              </span>
            </button>
          ))}
          {!devices.length && (
            <div className="ppanel__info castpick__searching">
              {!waited && <Spinner size="sm" />}
              <span>{waited ? t('cast.none') : t('cast.searching')}</span>
            </div>
          )}
        </div>
      )}
      {error && <div className="ppanel__info castpick__error">{error}</div>}
    </div>
  );
}

/** Mini-barre affichée hors du lecteur pendant une diffusion : retour au lecteur, pause, arrêt. */
export function CastBar() {
  const cast = useCast();
  const navigate = useNavigate();
  if (!cast.device || !cast.item) return null;
  const it = cast.item;
  const img = landscapeUrl(it, 320);
  const title = it.Type === 'Episode' ? `${it.SeriesName || ''} · ${episodeCode(it)}` : it.Name;
  const pct = cast.duration ? Math.min(100, (cast.time / cast.duration) * 100) : 0;
  return (
    <div className="castbar">
      <button className="castbar__main" onClick={() => navigate(`/play/${it.Id}`)}>
        <div className="castbar__thumb">{img && <img src={img} alt="" />}</div>
        <div className="castbar__text">
          <strong>{title}</strong>
          <small>
            <I.Cast /> {t('cast.playingOn', { name: cast.device.name })}
          </small>
        </div>
      </button>
      <button
        className="pbtn"
        onClick={castTogglePlay}
        aria-label={cast.state === 'PAUSED' ? t('player.play') : t('player.pause')}
      >
        {cast.state === 'PAUSED' ? <I.Play /> : <I.Pause />}
      </button>
      <button className="pbtn" onClick={() => disconnectDevice()} aria-label={t('cast.disconnect')} title={t('cast.disconnect')}>
        <I.Close />
      </button>
      <div className="castbar__progress">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
