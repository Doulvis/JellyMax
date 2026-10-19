import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, normalizeServerUrl } from '../api/client';
import type { PublicSystemInfo } from '../api/types';
import { Logo, Spinner } from '../components/Common';
import { t } from '../i18n';
import { useAuth } from '../state/auth';

function candidates(input: string): string[] {
  const base = normalizeServerUrl(input);
  const out = [base];
  try {
    const u = new URL(base);
    if (!u.port && (u.pathname === '/' || u.pathname === '')) {
      const host = `${u.protocol}//${u.hostname}`;
      if (u.protocol === 'http:') out.push(`${host}:8096`);
      else out.push(`${host}:8920`);
    }
  } catch {
    /* URL invalide : on tentera tout de même la saisie brute */
  }
  return out;
}

function versionOk(v: string) {
  const [major, minor] = v.split('.').map((n) => parseInt(n, 10) || 0);
  return major > 10 || (major === 10 && minor >= 9);
}

export default function ServerConnect() {
  const { server, session, profiles, setServer } = useAuth();
  const navigate = useNavigate();
  const [url, setUrl] = useState(server ? server.url : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    let found: { url: string; info: PublicSystemInfo } | null = null;
    for (const c of candidates(url)) {
      try {
        const info = await api.publicInfo(c);
        if (info && info.Id) {
          found = { url: c, info };
          break;
        }
      } catch {
        /* candidat suivant */
      }
    }
    setBusy(false);
    if (!found) {
      setError(t('connect.unreachable'));
      return;
    }
    if (!versionOk(found.info.Version)) {
      setError(t('connect.tooOld', { v: found.info.Version }));
      return;
    }
    setServer({ url: found.url, id: found.info.Id, name: found.info.ServerName, version: found.info.Version });
    navigate('/login', { replace: true });
  };

  return (
    <div className="auth">
      <div className="auth__logo">
        <Logo withMark />
      </div>
      <h1>{t('connect.title')}</h1>
      <p className="auth__sub">{t('connect.sub')}</p>
      <form className="auth-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="server-url">{t('connect.label')}</label>
          <input
            id="server-url"
            type="url"
            inputMode="url"
            autoFocus
            autoComplete="url"
            spellCheck={false}
            placeholder="http://192.168.1.20:8096"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy || !url.trim()}>
          {busy ? <Spinner size="sm" /> : t('connect.button')}
        </button>
        <p className="hint">{t('connect.hint')}</p>
        {profiles.length > 0 && (
          <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate('/profiles')}>
            {t('login.backProfiles')}
          </button>
        )}
      </form>
    </div>
  );
}
