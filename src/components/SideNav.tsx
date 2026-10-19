import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { isBackKey } from '../platform';
import { useAuth } from '../state/auth';
import { AvatarPicker } from './AvatarPicker';
import { Avatar, LogoMark } from './Common';
import { Film, Gear, Heart, Home, Logout, Pencil, Search, Tv, Users } from './Icons';

const ITEMS = [
  { to: '/search', key: 'nav.search', Icon: Search, end: false },
  { to: '/', key: 'nav.home', Icon: Home, end: true },
  { to: '/movies', key: 'nav.movies', Icon: Film, end: false },
  { to: '/shows', key: 'nav.shows', Icon: Tv, end: false },
  { to: '/mylist', key: 'nav.mylist', Icon: Heart, end: false },
] as const;

/** Barre de navigation verticale façon HBO Max : icônes, qui s'élargit au survol / au focus. */
export function SideNav() {
  const { session, logout, leaveProfile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [editAvatar, setEditAvatar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        setMenu(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    const raf = requestAnimationFrame(() => {
      const first = menuRef.current && (menuRef.current.querySelector('.menu a, .menu button') as HTMLElement | null);
      if (first) first.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  if (!session) return null;

  const switchProfile = () => {
    setMenu(false);
    leaveProfile();
    navigate('/profiles', { replace: true });
  };
  const signOut = async () => {
    setMenu(false);
    await logout();
    navigate('/profiles', { replace: true });
  };

  return (
    <>
      <aside className={`sidenav ${menu ? 'is-open' : ''}`}>
        <Link to="/" className="sidenav__brand" tabIndex={-1} aria-label={t('nav.home')}>
          <LogoMark />
          <span className="sidenav__label logo">
            Jelly<b>MAX</b>
          </span>
        </Link>

        <nav className="sidenav__nav">
          {ITEMS.map(({ to, key, Icon, end }) => {
            const label = t(key);
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className="sidenav__item"
                aria-label={label}
                // Clic souris : on retire le focus pour que la barre se replie dès que le curseur la quitte.
                onClick={(e) => {
                  if (e.detail > 0) e.currentTarget.blur();
                }}
              >
                <Icon />
                <span className="sidenav__label">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidenav__bottom" ref={menuRef}>
          {menu && (
            <div className="menu menu--side" data-nav-scope>
              <div className="menu__head">
                {session.userName}
                <small>{session.serverName || session.serverUrl}</small>
              </div>
              <button
                onClick={() => {
                  setMenu(false);
                  setEditAvatar(true);
                }}
              >
                <Pencil /> {t('profiles.editAvatar')}
              </button>
              <Link to="/settings" onClick={() => setMenu(false)}>
                <Gear /> {t('nav.settings')}
              </Link>
              <button onClick={switchProfile}>
                <Users /> {t('nav.switchProfile')}
              </button>
              <button onClick={signOut}>
                <Logout /> {t('nav.signOut')}
              </button>
            </div>
          )}
          <button className="sidenav__item sidenav__profile" onClick={() => setMenu((m) => !m)} aria-label={t('nav.profile')} aria-expanded={menu}>
            <Avatar userId={session.userId} tag={session.userImageTag} name={session.userName} size="sm" />
            <span className="sidenav__label">{session.userName}</span>
          </button>
        </div>
      </aside>
      {/* Voile derrière la barre : il s'élargit et s'estompe progressivement quand la barre s'ouvre. */}
      <div className="sidenav-shade" aria-hidden="true" />
      {editAvatar && (
        <AvatarPicker
          profile={session}
          onClose={() => setEditAvatar(false)}
          onUpdated={(tag) => updateProfile(session.id, { userImageTag: tag })}
        />
      )}
    </>
  );
}
