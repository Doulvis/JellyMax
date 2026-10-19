import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Chemins relatifs : l'application est chargée en file:// par Electron.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    // Electron 33 embarque Chromium 130 : pas besoin de transpiler pour d'anciens navigateurs.
    target: 'chrome130',
    cssTarget: 'chrome130',
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: false,
  },
});
