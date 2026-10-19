// Google Cast : lecture sur un Chromecast ou une TV compatible, depuis Windows (electron/cast.cjs) et Android
// (JellyMaxCastPlugin.java). L'appareil lit le flux directement depuis le serveur Jellyfin ; l'application
// sert de télécommande et transmet la progression au serveur.

import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { backdropUrl, landscapeUrl } from '../api/images';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { getSettings } from '../state/settings';
import { episodeCode, errorMessage, TPS } from '../utils/format';

export interface CastDevice {
  id: string;
  name: string;
  model?: string;
}

export type CastPlayerState = 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED';

export interface CastStatus {
  connected: boolean;
  state?: CastPlayerState;
  time?: number;
  duration?: number;
  idleReason?: string | null;
  volume?: number;
  muted?: boolean;
}

export interface CastMedia {
  url: string;
  contentType: string;
  title: string;
  subtitle?: string;
  image?: string;
  startTime: number;
  duration?: number;
}

export type CastCommand =
  | { type: 'PLAY' | 'PAUSE' | 'STOP' }
  | { type: 'SEEK'; time: number }
  | { type: 'VOLUME'; level: number };

/** Couche native (Windows ou Android). */
export interface CastBackend {
  discover(onDevices: (list: CastDevice[]) => void): () => void;
  connect(id: string): Promise<{ name: string }>;
  load(media: CastMedia): Promise<void>;
  control(cmd: CastCommand): void;
  disconnect(): Promise<void>;
  onStatus(cb: (s: CastStatus) => void): void;
  /** Nom de l'appareil déjà connecté (session encore active), sinon null. */
  current(): Promise<string | null>;
}

interface CastSessionInfo {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  audioIndex?: number;
  subIndex: number;
}

/** finished : fin de la vidéo ; stopped : diffusion arrêtée ou appareil perdu ; error : lecture impossible sur l'appareil. */
export type CastEndReason = 'finished' | 'stopped' | 'error';

export interface CastState {
  supported: boolean;
  device: { name: string } | null;
  connecting: boolean;
  /** Élément en cours de lecture sur l'appareil. */
  item: BaseItem | null;
  loading: boolean;
  state: CastPlayerState;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Fin de la diffusion d'un élément (terminé, arrêté ou appareil perdu), pour la reprise par le lecteur. */
  lastEnd: { seq: number; itemId: string; reason: CastEndReason; time: number } | null;
}

let backend: CastBackend | null = null;
let session: CastSessionInfo | null = null;
let lastReport = 0;
let endSeq = 0;
let state: CastState = {
  supported: false,
  device: null,
  connecting: false,
  item: null,
  loading: false,
  state: 'IDLE',
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  lastEnd: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<CastState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function castState() {
  return state;
}

export function useCast(): CastState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** L'élément est-il en cours de diffusion sur un appareil ? */
export function isCasting(itemId?: string) {
  return !!state.device && !!state.item && (!itemId || state.item.Id === itemId);
}

// ---------------------------------------------------------------------------
// Rapports de lecture au serveur Jellyfin
// ---------------------------------------------------------------------------

function payload(): Record<string, unknown> | null {
  const s = session;
  if (!s) return null;
  return {
    ItemId: s.itemId,
    MediaSourceId: s.mediaSourceId,
    PlaySessionId: s.playSessionId,
    PlayMethod: s.playMethod,
    AudioStreamIndex: s.audioIndex,
    SubtitleStreamIndex: s.subIndex,
    PositionTicks: Math.floor(state.time * TPS),
    IsPaused: state.state === 'PAUSED',
    IsMuted: state.muted,
    VolumeLevel: Math.round(state.volume * 100),
    CanSeek: true,
  };
}

/** Termine le suivi de l'élément diffusé ; notify = false quand un autre élément le remplace aussitôt. */
function endItem(reason: CastEndReason, notify = true) {
  const s = session;
  const it = state.item;
  if (s) {
    const p = payload();
    if (p) api.reportStopped(p).catch(() => {});
    if (s.playMethod !== 'DirectPlay') api.stopEncoding(s.playSessionId).catch(() => {});
    session = null;
  }
  if (it) set(notify ? { item: null, lastEnd: { seq: ++endSeq, itemId: it.Id, reason, time: state.time } } : { item: null });
}

function onStatus(s: CastStatus) {
  if (!s.connected) {
    endItem('stopped');
    set({ device: null, connecting: false, loading: false, state: 'IDLE' });
    return;
  }
  const patch: Partial<CastState> = {};
  if (s.state) patch.state = s.state;
  if (s.time != null) patch.time = s.time;
  if (s.duration) patch.duration = s.duration;
  if (s.volume != null) patch.volume = s.volume;
  if (s.muted != null) patch.muted = s.muted;
  set(patch);
  if (state.loading || !state.item) return;
  // Fin de lecture sur l'appareil (fin du film, arrêt depuis la TV, erreur de lecture).
  if (s.state === 'IDLE' && s.idleReason) {
    endItem(s.idleReason === 'FINISHED' ? 'finished' : s.idleReason === 'ERROR' ? 'error' : 'stopped');
    return;
  }
  const now = Date.now();
  if (now - lastReport > 10000) {
    lastReport = now;
    const p = payload();
    if (p) api.reportProgress(p).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Profil de lecture d'un Chromecast (récepteur multimédia par défaut de Google)
// ---------------------------------------------------------------------------

function castProfile(maxBitrate: number) {
  return {
    Name: 'JellyMax Cast',
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9', AudioCodec: 'vorbis,opus' },
    ],
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        Context: 'Streaming',
        Protocol: 'hls',
        MaxAudioChannels: '2',
        MinSegments: '1',
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: 'Video',
        Codec: 'h264',
        Conditions: [
          { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
          { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '41', IsRequired: false },
          { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
        ],
      },
    ],
    // Aucun format de sous-titres externe : les sous-titres choisis sont incrustés dans l'image par le serveur.
    SubtitleProfiles: [],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
  };
}

function serverReachable() {
  try {
    const host = new URL(api.baseUrl).hostname;
    return !/^(localhost|127\.|\[?::1\]?$)/i.test(host);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function discoverDevices(onDevices: (list: CastDevice[]) => void): () => void {
  return backend ? backend.discover(onDevices) : () => {};
}

export async function connectDevice(device: CastDevice) {
  if (!backend) return;
  set({ connecting: true });
  try {
    const r = await backend.connect(device.id);
    set({ device: { name: r.name || device.name }, connecting: false, state: 'IDLE', time: 0, duration: 0 });
  } catch (e) {
    set({ connecting: false });
    throw new Error(t('cast.connectFailed', { name: device.name, reason: errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
  }
}

export async function disconnectDevice() {
  if (!backend) return;
  endItem('stopped');
  await backend.disconnect().catch(() => {});
  set({ device: null, state: 'IDLE' });
}

/** Envoie un élément sur l'appareil connecté, à partir de la position indiquée. */
export async function castItem(item: BaseItem, startSec: number, audioIndex: number | undefined, subIndex: number) {
  if (!backend || !state.device) throw new Error(t('cast.notConnected'));
  if (!serverReachable()) throw new Error(t('cast.localServer'));
  if (state.item) endItem('stopped', false);
  set({ item, loading: true, state: 'BUFFERING', time: startSec, duration: item.RunTimeTicks ? item.RunTimeTicks / TPS : 0 });
  try {
    const bitrate = getSettings().maxBitrate;
    const info = await api.playbackInfo(item.Id, {
      UserId: api.userId,
      DeviceProfile: castProfile(bitrate),
      MaxStreamingBitrate: bitrate,
      StartTimeTicks: Math.floor(startSec * TPS),
      AudioStreamIndex: audioIndex,
      SubtitleStreamIndex: subIndex,
      MediaSourceId: item.MediaSources && item.MediaSources[0] ? item.MediaSources[0].Id : undefined,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    });
    if (info.ErrorCode) throw new Error(t('player.err.refused', { code: info.ErrorCode }));
    const source = info.MediaSources && info.MediaSources[0];
    if (!source) throw new Error(t('player.noSource'));

    let url: string;
    let contentType: string;
    let playMethod: CastSessionInfo['playMethod'];
    let start = startSec;
    if (source.SupportsDirectPlay) {
      url = api.directPlayUrl(item.Id, source);
      contentType = /webm/i.test(source.Container || '') ? 'video/webm' : 'video/mp4';
      playMethod = 'DirectPlay';
    } else if (source.TranscodingUrl) {
      url = api.absolute(source.TranscodingUrl);
      contentType = 'application/x-mpegURL';
      playMethod = source.SupportsDirectStream ? 'DirectStream' : 'Transcode';
      // Le flux transcodé démarre déjà à la position demandée.
      if (/[?&]StartTimeTicks=/i.test(url)) start = 0;
    } else {
      throw new Error(t('player.unsupported'));
    }

    const episode = item.Type === 'Episode';
    await backend.load({
      url,
      contentType,
      title: (episode ? item.SeriesName : item.Name) || item.Name,
      subtitle: episode ? [episodeCode(item), item.Name].filter(Boolean).join(' · ') : undefined,
      image: backdropUrl(item, 1280) || landscapeUrl(item, 1280) || undefined,
      startTime: start,
      duration: item.RunTimeTicks ? item.RunTimeTicks / TPS : undefined,
    });
    session = { itemId: item.Id, mediaSourceId: source.Id, playSessionId: info.PlaySessionId, playMethod, audioIndex, subIndex };
    set({ loading: false });
    lastReport = Date.now();
    const p = payload();
    if (p) api.reportStart(p).catch(() => {});
  } catch (e) {
    set({ item: null, loading: false, state: 'IDLE' });
    throw new Error(errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

export function castControl(cmd: CastCommand) {
  if (!backend || !state.device) return;
  backend.control(cmd);
  if (cmd.type === 'SEEK') set({ time: cmd.time });
  else if (cmd.type === 'PAUSE') set({ state: 'PAUSED' });
  else if (cmd.type === 'PLAY') set({ state: 'PLAYING' });
  else if (cmd.type === 'VOLUME') set({ volume: cmd.level, muted: false });
}

export function castTogglePlay() {
  castControl({ type: state.state === 'PAUSED' ? 'PLAY' : 'PAUSE' });
}

export function castSeekBy(delta: number) {
  const max = state.duration || Infinity;
  castControl({ type: 'SEEK', time: Math.max(0, Math.min(max - 1, state.time + delta)) });
}


// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

export function setCastBackend(b: CastBackend) {
  backend = b;
  b.onStatus(onStatus);
  set({ supported: true });
  b.current()
    .then((name) => {
      if (name && !state.device) set({ device: { name } });
    })
    .catch(() => {});
}

// Windows : couche Cast exposée par electron/preload.cjs.
if (typeof window !== 'undefined' && window.jellymax && window.jellymax.cast) {
  const c = window.jellymax.cast;
  setCastBackend({
    discover(onDevices) {
      const off = c.onDevices(onDevices);
      c.discover(true);
      return () => {
        off();
        c.discover(false);
      };
    },
    connect: (id) => c.connect(id),
    load: (m) => c.load(m),
    control: (cmd) => c.control(cmd),
    disconnect: () => c.disconnect(),
    onStatus: (cb) => {
      c.onStatus(cb);
    },
    current: () => c.current().then((d) => (d ? d.name : null)),
  });
}
