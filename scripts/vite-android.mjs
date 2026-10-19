// Build Android : `vite build --mode android` produit dist-android/, embarqué dans l'APK par Capacitor.
//  - JavaScript ciblant le WebView Android (Chromium 89+, Android 7 et plus avec WebView à jour) ;
//  - viewport mobile sans zoom, contenu sous les bords arrondis / encoches.
export const ANDROID_OUT_DIR = 'dist-android';
const TARGET = 'chrome89';

export function androidPlugin() {
  return {
    name: 'jellymax-android',
    enforce: 'post',
    apply: (_config, env) => env.mode === 'android',
    config: () => ({
      build: {
        outDir: ANDROID_OUT_DIR,
        target: TARGET,
        cssTarget: TARGET,
      },
    }),
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          /<meta name="viewport"[^>]*>/,
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
        );
      },
    },
  };
}
