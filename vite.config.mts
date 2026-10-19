import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tizenPlugin } from './scripts/vite-tizen.mjs';

export default defineConfig({
  // Chemins relatifs : l'application est chargée en file:// par Electron et par les TV Samsung.
  base: './',
  plugins: [react(), tizenPlugin()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    // Electron 33 embarque Chromium 130 : pas besoin de transpiler pour d'anciens navigateurs.
    // Le build TV (--mode tizen) abaisse cette cible, voir scripts/vite-tizen.mjs.
    target: 'chrome130',
    cssTarget: 'chrome130',
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: false,
  },
});
