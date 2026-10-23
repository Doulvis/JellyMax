import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/Common';
import { Close, Users, WatchTogether as WatchIcon } from '../components/Icons';
import { isBackKey } from '../platform';
import { t } from '../i18n';
import { useAuth } from '../state/auth';
import {
  closeWatchTogether,
  createGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  playInGroup,
  setSyncPlayNavigator,
  syncPlayError,
  useSyncPlay,
  type GroupInfo,
} from './syncplay';

function Panel() {
  const sp = useSyncPlay();
  const { session } = useAuth();
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { itemId, name } = sp.panel;

  const refresh = () => {
    setError(null);
    setGroups(null);
    listGroups().then(setGroups, (e) => {
      setGroups([]);
      setError(syncPlayError(e));
    });
  };

  useEffect(() => {
    if (!sp.group) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!sp.group]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        closeWatchTogether();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) closeWatchTogether();
    } catch (e) {
      setError(syncPlayError(e));
    } finally {
      setBusy(false);
    }
  };

  const groupName = t('sp.groupOf', { name: (session && session.userName) || 'JellyMax' });

  return (
    <div className="modal" data-nav-scope onMouseDown={(e) => e.target === e.currentTarget && closeWatchTogether()}>
      <div className="modal__card wt" role="dialog" aria-modal="true" aria-label={t('sp.watchTogether')}>
        <div className="modal__head">
          <span className="wt__icon">
            <WatchIcon />
          </span>
          <div className="modal__titles">
            <h2>{t('sp.watchTogether')}</h2>
            <p>{t('sp.hint')}</p>
          </div>
          <button className="pbtn" onClick={closeWatchTogether} aria-label={t('common.close')}>
            <Close />
          </button>
        </div>

        {error && <p className="wt__error">{error}</p>}

        {sp.group ? (
          <div className="wt__group">
            <div className="wt__group-name">{sp.group.GroupName}</div>
            <div className="wt__people">
              {sp.group.Participants.map((p, i) => (
                <span key={`${p}-${i}`} className="chip">
                  <Users /> {p}
                </span>
              ))}
            </div>
            <div className="row">
              {itemId && (
                <button className="btn btn--primary" disabled={busy} onClick={() => run(() => playInGroup(itemId), true)} autoFocus>
                  {t('sp.playForGroup', { name: name || '' })}
                </button>
              )}
              <button className="btn btn--ghost" disabled={busy} onClick={() => run(leaveGroup, true)}>
                {t('sp.leave')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className="btn btn--primary wt__create"
              disabled={busy}
              onClick={() => run(() => createGroup(groupName, itemId), true)}
              autoFocus
            >
              {busy ? <Spinner size="sm" /> : <WatchIcon />}
              {itemId ? t('sp.createWith', { name: name || '' }) : t('sp.create')}
            </button>
            <div className="wt__list">
              <h3>{t('sp.groups')}</h3>
              {groups === null ? (
                <div className="center-pad">
                  <Spinner />
                </div>
              ) : groups.length === 0 ? (
                <p className="wt__empty">{t('sp.noGroups')}</p>
              ) : (
                groups.map((g) => (
                  <div key={g.GroupId} className="wt__item">
                    <div>
                      <strong>{g.GroupName}</strong>
                      <span>{g.Participants.length === 1 ? t('sp.people1') : t('sp.peopleN', { n: g.Participants.length })}</span>
                    </div>
                    <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => joinGroup(g.GroupId), true)}>
                      {t('sp.join')}
                    </button>
                  </div>
                ))
              )}
              {groups !== null && (
                <button className="link-btn" onClick={refresh}>
                  {t('sp.refresh')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Fenêtre « Regarder ensemble », notifications du groupe et navigation vers le titre lancé par le groupe. */
export function WatchTogetherHost() {
  const sp = useSyncPlay();
  const navigate = useNavigate();

  useEffect(() => {
    setSyncPlayNavigator((to, replace) => navigate(to, { replace }));
    return () => setSyncPlayNavigator(null);
  }, [navigate]);

  return (
    <>
      {sp.panel.open && <Panel />}
      {sp.toasts.length > 0 && (
        <div className="toasts" aria-live="polite">
          {sp.toasts.map((x) => (
            <div key={x.id} className="toast">
              <WatchIcon />
              {x.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
