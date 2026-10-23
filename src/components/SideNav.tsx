import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { isBackKey, isMobile } from '../platform';
import { useAuth } from '../state/auth';
import { AvatarPicker } from './AvatarPicker';
import { Avatar, LogoMark } from './Common';
import { downloadsSupported } from '../downloads/store';
import { openWatchTogether, useSyncPlay } from '../syncplay/syncplay';
import { ChevronLeft, Download, Film, Gear, Heart, Home, Logout, Pencil, Search, Tv, Users, WatchTogether } from './Icons';

const ITEMS = [
  { to: '/search', key: 'nav.search', Icon: Search, end: false },
  { to: '/', key: 'nav.home', Icon: Home, end: true },
  { to: '/movies', key: 'nav.movies', Icon: Film, end: false },
  { to: '/shows', key: 'nav.shows', Icon: Tv, end: false },
  { to: '/mylist', key: 'nav.mylist', Icon: Heart, end: false },
  { to: '/downloads', key: 'nav.downloads', Icon: Download, end: false },
] as const;

// Téléchargements : Windows et Android uniquement.
const NAV_ITEMS = ITEMS.filter((i) => i.to !== '/downloads' || downloadsSupported);

// Ordre des onglets sur mobile : l'accueil en premier, comme les applications de streaming.
const TAB_ITEMS = [ITEMS[1], ITEMS[2], ITEMS[3], ITEMS[4], ITEMS[5], ITEMS[0]].filter((i) => NAV_ITEMS.indexOf(i) >= 0);
const TAB_PATHS = ['/', '/search', '/movies', '/shows', '/mylist', '/downloads', '/settings'];

/**
 * Mobile : la barre du haut devient opaque dès qu'on fait défiler, et la barre d'onglets flottante
 * se cache quand on descend dans la page puis réapparaît dès qu'on remonte.
 */
function useScrollChrome(enabled: boolean) {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    let raf = 0;
    const run = () => {
      raf = 0;
      const y = window.scrollY;
      setSolid(y > 24);
      if (y < 120) setHidden(false);
      else if (Math.abs(y - last) > 10) setHidden(y > last);
      if (Math.abs(y - last) > 10 || y < 120) last = y;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    run();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return { solid, hidden };
}

/** Barre de navigation verticale façon HBO Max : icônes, qui s'élargit au survol / au focus. */
export function SideNav() {
  const { session, logout, leaveProfile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [editAvatar, setEditAvatar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const chrome = useScrollChrome(isMobile);
  const sp = useSyncPlay();

  // Le menu du profil se referme quand on change de page.
  useEffect(() => setMenu(false), [pathname]);

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

  const menuItems = (
    <>
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
      <button
        onClick={() => {
          setMenu(false);
          openWatchTogether();
        }}
      >
        <WatchTogether /> {sp.group ? t('sp.inGroupMenu', { name: sp.group.GroupName }) : t('sp.watchTogether')}
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
    </>
  );

  const avatarPicker = editAvatar && (
    <AvatarPicker
      profile={session}
      onClose={() => setEditAvatar(false)}
      onUpdated={(tag) => updateProfile(session.id, { userImageTag: tag })}
    />
  );

  // Téléphones et tablettes : barre du haut (logo ou retour, profil) et barre d'onglets flottante
  // au centre en bas de l'écran, à portée de pouce.
  if (isMobile) {
    const isRoot = TAB_PATHS.indexOf(pathname) >= 0;
    const goBack = () => {
      const state = window.history.state as { idx?: number } | null;
      if (state && state.idx) navigate(-1);
      else navigate('/', { replace: true });
    };
    return (
      <>
        <header className={`topbar ${chrome.solid ? 'is-solid' : ''}`}>
          {isRoot ? (
            <Link to="/" replace className="logo topbar__logo" aria-label={t('nav.home')}>
              <LogoMark />
              <span>
                Jelly<b>MAX</b>
              </span>
            </Link>
          ) : (
            <button className="topbar__btn" onClick={goBack} aria-label={t('common.back')}>
              <ChevronLeft />
            </button>
          )}
          <button
            className="topbar__profile"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setMenu((m) => !m)}
            aria-label={t('nav.profile')}
            aria-expanded={menu}
          >
            <Avatar userId={session.userId} tag={session.userImageTag} name={session.userName} size="sm" />
          </button>
        </header>
        <nav className={`tabbar ${chrome.hidden && !menu ? 'is-hidden' : ''}`}>
          {TAB_ITEMS.map(({ to, key, Icon, end }) => (
            <NavLink key={to} to={to} end={end} replace className="tabbar__item" aria-label={t(key)}>
              <Icon />
              <span>{t(key)}</span>
            </NavLink>
          ))}
        </nav>
        {menu && (
          <>
            <div className="sheet-backdrop" />
            <div className="menu menu--sheet" ref={menuRef} data-nav-scope>
              {menuItems}
            </div>
          </>
        )}
        {avatarPicker}
      </>
    );
  }

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
          {NAV_ITEMS.map(({ to, key, Icon, end }) => {
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
              {menuItems}
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
      {avatarPicker}
    </>
  );
}
