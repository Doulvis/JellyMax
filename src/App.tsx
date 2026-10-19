import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SideNav } from './components/SideNav';
import Catalog from './pages/Catalog';
import Detail from './pages/Detail';
import Home from './pages/Home';
import Library from './pages/Library';
import Login from './pages/Login';
import MyList from './pages/MyList';
import PersonPage from './pages/Person';
import Profiles from './pages/Profiles';
import SearchPage from './pages/Search';
import ServerConnect from './pages/ServerConnect';
import SettingsPage from './pages/Settings';
import { isBackKey } from './platform';
import { AuthProvider, useAuth } from './state/auth';

// Le lecteur (et hls.js) n'est chargé qu'à la première lecture : démarrage plus rapide.
const Player = lazy(() => import('./pages/Player'));

function RequireAuth({ children }: { children: ReactElement }) {
  const { session, server, profiles } = useAuth();
  if (!session) return <Navigate to={profiles.length ? '/profiles' : server ? '/login' : '/connect'} replace />;
  return children;
}

function MainLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <div className="drag-strip" />
      <SideNav />
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}

/** Bouton "précédent" de la souris ou du clavier, Alt+← */
function BackHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isBackKey(e) || (e.altKey && e.key === 'ArrowLeft')) {
        e.preventDefault();
        navigate(-1);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <BackHandler />
        <Routes>
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/connect" element={<ServerConnect />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/play/:id"
            element={
              <RequireAuth>
                <Suspense fallback={<div className="player" />}>
                  <Player />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <MainLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="movies" element={<Catalog kind="movies" />} />
            <Route path="shows" element={<Catalog kind="shows" />} />
            <Route path="library/:parentId" element={<Library />} />
            <Route path="item/:id" element={<Detail />} />
            <Route path="person/:id" element={<PersonPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="mylist" element={<MyList />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
