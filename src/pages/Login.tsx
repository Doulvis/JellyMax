import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AuthResult, UserDto } from '../api/types';
import { Avatar, Logo, Spinner } from '../components/Common';
import { ArrowLeft, Key, Plus, Server } from '../components/Icons';
import { t } from '../i18n';
import { useAuth } from '../state/auth';
import { errorMessage } from '../utils/format';

type Mode = 'profiles' | 'password' | 'manual' | 'quickconnect';

export default function Login() {
  const { server, session, profiles, setServer, completeLogin } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // Reconnexion d'un profil existant : le nom d'utilisateur est déjà connu.
  const presetUser = sp.get('user') || '';
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [mode, setMode] = useState<Mode>(presetUser ? 'manual' : 'profiles');
  const [selected, setSelected] = useState<UserDto | null>(null);
  const [username, setUsername] = useState(presetUser);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [qcCode, setQcCode] = useState<string | null>(null);
  const qcTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .publicUsers()
      .then((u) => {
        setUsers(u || []);
        if (!u || !u.length) setMode('manual');
      })
      .catch(() => {
        setUsers([]);
        setMode('manual');
      });
    api
      .quickConnectEnabled()
      .then((v) => setQcEnabled(!!v))
      .catch(() => {});
    return () => window.clearTimeout(qcTimer.current);
  }, []);

  if (session) return <Navigate to="/" replace />;
  if (!server) return <Navigate to="/connect" replace />;

  const finish = (r: AuthResult) => {
    completeLogin(r);
    navigate('/', { replace: true });
  };

  const login = async (name: string, pw: string) => {
    setBusy(true);
    setError(null);
    try {
      finish(await api.authenticate(name, pw));
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 401) setError(t('login.badCreds'));
      else setError(errorMessage(e));
    }
  };

  const pickUser = (u: UserDto) => {
    setError(null);
    setSelected(u);
    setPassword('');
    if (!u.HasPassword) login(u.Name, '');
    else setMode('password');
  };

  const startQuickConnect = async () => {
    setError(null);
    setMode('quickconnect');
    setQcCode(null);
    try {
      const init = await api.quickConnectInitiate();
      setQcCode(init.Code);
      const poll = async () => {
        try {
          const st = await api.quickConnectState(init.Secret);
          if (st && st.Authenticated) {
            finish(await api.authenticateQuickConnect(init.Secret));
            return;
          }
        } catch {
          /* on réessaie */
        }
        qcTimer.current = window.setTimeout(poll, 3000);
      };
      qcTimer.current = window.setTimeout(poll, 3000);
    } catch (e) {
      setError(errorMessage(e));
      setMode('profiles');
    }
  };

  const back = () => {
    window.clearTimeout(qcTimer.current);
    setError(null);
    setBusy(false);
    setMode(users && users.length ? 'profiles' : 'manual');
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (selected) login(selected.Name, password);
  };
  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim()) login(username.trim(), password);
  };

  const changeServer = () => {
    setServer(null);
    navigate('/connect', { replace: true });
  };

  return (
    <div className="auth">
      <div className="auth__logo">
        <Logo withMark />
      </div>

      {mode === 'profiles' && (
        <>
          <h1>{t('login.chooseAccount')}</h1>
          <p className="auth__sub">{server.name}</p>
          {users === null ? (
            <Spinner size="lg" />
          ) : (
            <div className="profiles">
              {users.map((u) => (
                <button key={u.Id} className="profile-tile" onClick={() => pickUser(u)} disabled={busy}>
                  <Avatar userId={u.Id} tag={u.PrimaryImageTag} name={u.Name} size="xl" />
                  <span>{u.Name}</span>
                </button>
              ))}
              <button
                className="profile-tile"
                onClick={() => {
                  setError(null);
                  setUsername('');
                  setPassword('');
                  setMode('manual');
                }}
              >
                <div className="avatar avatar--xl avatar--add">
                  <Plus />
                </div>
                <span>{t('login.other')}</span>
              </button>
            </div>
          )}
          {error && <div className="form-error form-error--center">{error}</div>}
        </>
      )}

      {mode === 'password' && selected && (
        <form className="auth-card" onSubmit={submitPassword}>
          <div className="auth-card__user">
            <Avatar userId={selected.Id} tag={selected.PrimaryImageTag} name={selected.Name} size="xl" />
            <h2>{selected.Name}</h2>
          </div>
          <div className="field">
            <label htmlFor="pw">{t('login.password')}</label>
            <input id="pw" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
            {busy ? <Spinner size="sm" /> : t('login.signIn')}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={back}>
            {t('common.back')}
          </button>
        </form>
      )}

      {mode === 'manual' && (
        <form className="auth-card" onSubmit={submitManual}>
          <h1 className="auth-card__title">{t('login.title')}</h1>
          <p className="auth__sub auth__sub--left">{server.name}</p>
          <div className="field">
            <label htmlFor="user">{t('login.username')}</label>
            <input
              id="user"
              autoFocus
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pw2">{t('login.password')}</label>
            <input
              id="pw2"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy || !username.trim()}>
            {busy ? <Spinner size="sm" /> : t('login.signIn')}
          </button>
          {users && users.length > 0 && (
            <button type="button" className="btn btn--ghost btn--block" onClick={back}>
              {t('login.backProfiles')}
            </button>
          )}
        </form>
      )}

      {mode === 'quickconnect' && (
        <div className="auth-card">
          <h1 className="auth-card__title">Quick Connect</h1>
          <p className="hint">{t('login.qcHint')}</p>
          <div className="qc-code">{qcCode || <Spinner />}</div>
          <p className="hint">{t('login.qcWaiting')}</p>
          {error && <div className="form-error">{error}</div>}
          <button type="button" className="btn btn--ghost btn--block" onClick={back}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {mode !== 'quickconnect' && (
        <div className="auth__links">
          {qcEnabled && (
            <button className="link-btn" onClick={startQuickConnect}>
              <Key /> Quick Connect
            </button>
          )}
          <button className="link-btn" onClick={changeServer}>
            <Server /> {t('nav.changeServer')}
          </button>
          {profiles.length > 0 && (
            <button className="link-btn" onClick={() => navigate('/profiles')}>
              <ArrowLeft /> {t('login.backProfiles')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
