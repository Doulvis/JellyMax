import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { androidPlugin } from './scripts/vite-android.mjs';
import { jellymaxConfig, remotePlugin } from './scripts/vite-remote.mjs';
import { tizenPlugin } from './scripts/vite-tizen.mjs';

export default defineConfig({
  // Chemins relatifs : l'application est chargée en file:// par Electron et par les TV Samsung,
  // ou depuis le serveur de mises à jour (voir scripts/vite-remote.mjs).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(jellymaxConfig().version) },
  plugins: [react(), tizenPlugin(), androidPlugin(), remotePlugin()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    // Electron 33 embarque Chromium 130 : pas besoin de transpiler pour d'anciens navigateurs.
    // Les builds TV (--mode tizen) et Android (--mode android) l'adaptent, voir scripts/.
    target: 'chrome130',
    cssTarget: 'chrome130',
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: false,
  },
});
