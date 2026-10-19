// Remplace hls.js dans le build TV : les TV Samsung lisent le HLS nativement.
// Retirer hls.js allège l'application d'environ 400 ko de JavaScript à analyser au démarrage.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default class Hls {
  static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  static isSupported() {
    return false;
  }
  constructor(_config?: any) {}
  on(_event: string, _cb: (...args: any[]) => void) {}
  loadSource(_url: string) {}
  attachMedia(_media: HTMLMediaElement) {}
  startLoad() {}
  recoverMediaError() {}
  swapAudioCodec() {}
  destroy() {}
}
