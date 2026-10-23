import './polyfills';
// Uniquement le jeu de caractères latin (couvre le français et l'anglais) : application plus légère.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './styles/global.css';
import './styles/mobile.css';

import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initDownloads } from './downloads/store';
import { initSpatialNav } from './nav/spatial';
import { initPlatform, isAndroid } from './platform';
import { useSettings } from './state/settings';

initPlatform();
initSpatialNav();
if (isAndroid) {
  import('./android').then((m) => {
    m.initAndroid();
    initDownloads();
  });
} else initDownloads();

window.addEventListener('unhandledrejection', (e) => {
  console.warn('[JellyMax] promesse non gérée', e.reason);
});

/** Changer de langue remonte toute l'interface pour que chaque texte soit retraduit. */
function LanguageRoot() {
  const { language } = useSettings();
  document.documentElement.lang = language;
  return <App key={language} />;
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <LanguageRoot />
  </ErrorBoundary>,
);
