import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AvatarPicker } from '../components/AvatarPicker';
import { Avatar, Logo, Switch } from '../components/Common';
import { Close, Pencil, Plus } from '../components/Icons';
import { t } from '../i18n';
import { useAuth, type Profile } from '../state/auth';
import { updateSettings, useSettings } from '../state/settings';

/** Écran "Qui regarde ?" : les profils enregistrés sur cet appareil. */
export default function Profiles() {
  const { session, profiles, selectProfile, removeProfile, updateProfile } = useAuth();
  const settings = useSettings();
  const navigate = useNavigate();
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  if (session) return <Navigate to="/" replace />;
  if (!profiles.length) return <Navigate to="/connect" replace />;

  const sorted = profiles.slice().sort((a, b) => b.lastUsed - a.lastUsed);
  const multiServer = new Set(profiles.map((p) => p.serverId)).size > 1;

  const open = (p: Profile) => {
    if (manage) {
      if (p.accessToken) setEditing(p);
      return;
    }
    if (selectProfile(p.id)) navigate('/', { replace: true });
    else navigate(`/login?user=${encodeURIComponent(p.userName)}`);
  };

  const remove = async (p: Profile) => {
    if (!window.confirm(t('profiles.confirmRemove', { name: p.userName }))) return;
    await removeProfile(p.id);
    if (profiles.length <= 1) setManage(false);
  };

  return (
    <div className="auth">
      <div className="auth__logo">
        <Logo withMark />
      </div>
      <h1>{t('login.who')}</h1>
      <div className="profiles">
        {sorted.map((p, i) => (
          <div key={p.id} className="profile-slot" style={{ animationDelay: `${i * 60}ms` }}>
            <button
              className={`profile-tile ${manage ? 'is-managing' : ''}`}
              onClick={() => open(p)}
              aria-label={manage ? t('profiles.editAvatar') : p.userName}
            >
              <div className="profile-tile__avatar">
                <Avatar userId={p.userId} tag={p.userImageTag} name={p.userName} server={p.serverUrl} size="xl" />
                {manage && p.accessToken && (
                  <span className="profile-tile__edit">
                    <Pencil />
                  </span>
                )}
              </div>
              <span className="profile-tile__name">{p.userName}</span>
              {(multiServer || !p.accessToken) && (
                <small className="profile-tile__server">{p.accessToken ? p.serverName : t('profiles.signInAgain')}</small>
              )}
            </button>
            {manage && (
              <button className="profile-remove" onClick={() => remove(p)} aria-label={t('profiles.remove')} title={t('profiles.remove')}>
                <Close />
              </button>
            )}
          </div>
        ))}
        {!manage && (
          <div className="profile-slot" style={{ animationDelay: `${sorted.length * 60}ms` }}>
            <button className="profile-tile" onClick={() => navigate('/connect')}>
              <div className="profile-tile__avatar">
                <div className="avatar avatar--xl avatar--add">
                  <Plus />
                </div>
              </div>
              <span className="profile-tile__name">{t('profiles.add')}</span>
            </button>
          </div>
        )}
      </div>

      <button className={`btn ${manage ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setManage((m) => !m)}>
        {manage ? t('profiles.done') : t('profiles.manage')}
      </button>

      <label className="auth__option">
        <Switch
          label={t('profiles.alwaysLast')}
          on={settings.skipProfilePicker}
          onChange={(v) => updateSettings({ skipProfilePicker: v })}
        />
        <span>{t('profiles.alwaysLast')}</span>
      </label>

      {editing && (
        <AvatarPicker
          profile={editing}
          onClose={() => setEditing(null)}
          onUpdated={(tag) => updateProfile(editing.id, { userImageTag: tag })}
        />
      )}
    </div>
  );
}
