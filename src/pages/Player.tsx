import Hls from 'hls.js';
import type { ErrorData } from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { buildDeviceProfile } from '../api/deviceProfile';
import { landscapeUrl } from '../api/images';
import type { BaseItem, MediaSegment, MediaStream, TrickplayInfo } from '../api/types';
import { Spinner } from '../components/Common';
import * as I from '../components/Icons';
import { isBackKey, isMobile, isTV, keyName, setPlaybackActive } from '../platform';
import { bitrateOptions, t } from '../i18n';
import { getSettings, updateSettings, useSettings } from '../state/settings';
import { subtitleVars } from '../utils/subtitles';
import { episodeCode, errorMessage, formatClock, formatRuntime, TPS } from '../utils/format';
import { activeCueHtml, parseVtt, type Cue } from '../utils/vtt';

type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';
type Panel = null | 'tracks' | 'quality' | 'episodes';

interface PlaySession {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  playMethod: PlayMethod;
  level: number; // 0 = tout autorisé, 1 = pas de lecture directe, 2 = transcodage complet
  audioIndex?: number;
  subIndex: number;
  burnedSub: boolean;
}

interface StartOptions {
  item: BaseItem;
  startSec: number;
  audioIndex?: number;
  subIndex: number;
  level: number;
}

type Trick = TrickplayInfo & { width: number; msid: string };

const METHOD_KEY = {
  DirectPlay: 'player.direct',
  DirectStream: 'player.remux',
  Transcode: 'player.transcode',
} as const;

function playbackErrorText(code: string) {
  switch (code) {
    case 'NotAllowed':
      return t('player.err.notAllowed');
    case 'NoCompatibleStream':
      return t('player.err.noStream');
    case 'RateLimitExceeded':
      return t('player.err.rate');
    default:
      return t('player.err.refused', { code });
  }
}

function trackLabel(s: MediaStream) {
  return s.DisplayTitle || s.Title || (s.Language ? s.Language.toUpperCase() : t('player.track', { n: s.Index }));
}

export default function Player() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();

  // Le ref vidéo n'est jamais remis à null : on en a besoin pendant le démontage pour le rapport final.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    if (el) videoRef.current = el;
  }, []);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<PlaySession | null>(null);
  const loadIdRef = useRef(0);
  const subLoadRef = useRef(0);
  const retryRef = useRef({ net: 0, media: 0 });
  const failLevelRef = useRef(0);
  const startPosRef = useRef(0);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const stallTimerRef = useRef<number | undefined>(undefined);
  const skippedRef = useRef<Set<string>>(new Set());

  const [item, setItem] = useState<BaseItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined);
  const [subIndex, setSubIndex] = useState(-1);
  const [streams, setStreams] = useState<MediaStream[]>([]);
  const [method, setMethod] = useState<PlayMethod | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cueHtml, setCueHtml] = useState('');
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [nextEp, setNextEp] = useState<BaseItem | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [bitrate, setBitrate] = useState(settings.maxBitrate);
  const [volume, setVolume] = useState(settings.volume);
  const [muted, setMuted] = useState(settings.muted);

  // État "vivant" lu par les écouteurs à longue durée de vie (pas de fermetures périmées).
  const live = useRef({ item, audioIndex, subIndex, bitrate, panel, controls, nextEp });
  live.current = { item, audioIndex, subIndex, bitrate, panel, controls, nextEp };

  // ---------------------------------------------------------------------------
  // Session de lecture
  // ---------------------------------------------------------------------------

  const payload = (): Record<string, unknown> | null => {
    const s = sessionRef.current;
    const v = videoRef.current;
    if (!s) return null;
    return {
      ItemId: s.itemId,
      MediaSourceId: s.mediaSourceId,
      PlaySessionId: s.playSessionId,
      PlayMethod: s.playMethod,
      AudioStreamIndex: s.audioIndex,
      SubtitleStreamIndex: s.subIndex,
      PositionTicks: Math.floor(((v && v.currentTime) || 0) * TPS),
      IsPaused: v ? v.paused : false,
      IsMuted: v ? v.muted : false,
      VolumeLevel: v ? Math.round(v.volume * 100) : 100,
      CanSeek: true,
    };
  };

  const reportProgress = () => {
    const p = payload();
    if (p) api.reportProgress(p).catch(() => {});
  };

  const endSession = (final: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const p = payload();
    if (final && p) api.reportStopped(p).catch(() => {});
    if (s.playMethod !== 'DirectPlay') api.stopEncoding(s.playSessionId).catch(() => {});
    sessionRef.current = null;
  };

  const teardownMedia = () => {
    window.clearTimeout(stallTimerRef.current);
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* ignore */
      }
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    }
  };

  const loadSubtitles = async (url: string) => {
    const token = ++subLoadRef.current;
    try {
      const text = await api.fetchText(url);
      if (token === subLoadRef.current) setCues(parseVtt(text));
    } catch {
      console.warn('[player] sous-titres indisponibles', url);
    }
  };

  const start = async (opts: StartOptions) => {
    const loadId = ++loadIdRef.current;
    const video = videoRef.current;
    if (!video) return;
    endSession(false);
    teardownMedia();
    subLoadRef.current++;
    setError(null);
    setBuffering(true);
    setCues([]);
    setCueHtml('');
    retryRef.current = { net: 0, media: 0 };
    startPosRef.current = opts.startSec;

    const { item: it, startSec, audioIndex: aIdx, subIndex: sIdx } = opts;
    let level = opts.level;

    // Une piste audio autre que celle par défaut du fichier impose un remux côté serveur
    // (le moteur vidéo ne sait pas changer de piste audio en lecture directe).
    const fileStreams = (it.MediaSources && it.MediaSources[0] && it.MediaSources[0].MediaStreams) || [];
    const audios = fileStreams.filter((s) => s.Type === 'Audio');
    const fileDefaultAudio = audios.find((a) => a.IsDefault) || audios[0];
    if (aIdx != null && fileDefaultAudio && aIdx !== fileDefaultAudio.Index) level = Math.max(level, 1);

    try {
      const info = await api.playbackInfo(it.Id, {
        UserId: api.userId,
        DeviceProfile: buildDeviceProfile(live.current.bitrate),
        MaxStreamingBitrate: live.current.bitrate,
        StartTimeTicks: Math.floor(startSec * TPS),
        AudioStreamIndex: aIdx,
        SubtitleStreamIndex: sIdx,
        MediaSourceId: it.MediaSources && it.MediaSources[0] ? it.MediaSources[0].Id : undefined,
        EnableDirectPlay: level < 1,
        EnableDirectStream: level < 2,
        EnableTranscoding: true,
        AllowVideoStreamCopy: level < 2,
        AllowAudioStreamCopy: level < 2,
        AutoOpenLiveStream: true,
      });
      if (loadId !== loadIdRef.current) return;
      if (info.ErrorCode) throw new Error(playbackErrorText(info.ErrorCode));
      const source = info.MediaSources && info.MediaSources[0];
      if (!source) throw new Error(t('player.noSource'));

      let url: string;
      let playMethod: PlayMethod;
      let isHls = false;
      if (level < 1 && source.SupportsDirectPlay) {
        url = api.directPlayUrl(it.Id, source);
        playMethod = 'DirectPlay';
      } else if (source.TranscodingUrl) {
        url = api.absolute(source.TranscodingUrl);
        isHls = source.TranscodingSubProtocol === 'hls' || /\.m3u8/i.test(url);
        playMethod = source.SupportsDirectStream && level < 2 ? 'DirectStream' : 'Transcode';
      } else if (source.SupportsDirectPlay) {
        url = api.directPlayUrl(it.Id, source);
        playMethod = 'DirectPlay';
      } else {
        throw new Error(t('player.unsupported'));
      }

      const srcStreams = source.MediaStreams || [];
      const sub = sIdx >= 0 ? srcStreams.find((s) => s.Type === 'Subtitle' && s.Index === sIdx) : undefined;
      sessionRef.current = {
        itemId: it.Id,
        mediaSourceId: source.Id,
        playSessionId: info.PlaySessionId,
        playMethod,
        level,
        audioIndex: aIdx,
        subIndex: sIdx,
        burnedSub: !!sub && sub.DeliveryMethod === 'Encode',
      };
      setStreams(srcStreams);
      setMethod(playMethod);

      const st = getSettings();
      video.volume = st.volume;
      video.muted = st.muted;

      // TV Samsung : le lecteur natif gère le HLS avec le décodage matériel, plus fiable que hls.js.
      const nativeHls = isTV && !!video.canPlayType('application/vnd.apple.mpegurl').replace(/no/, '');
      if (isHls && !nativeHls && Hls.isSupported()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config: any = {
          startPosition: startSec > 0 ? startSec : -1,
          maxBufferLength: 30,
          maxMaxBufferLength: 120,
          backBufferLength: 60,
          enableWorker: true,
          lowLatencyMode: false,
          manifestLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 3,
          levelLoadingTimeOut: 30000,
          fragLoadingTimeOut: 60000,
          fragLoadingMaxRetry: 6,
        };
        const hls = new Hls(config);
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_evt, data) => actions.current.onHlsError(data, loadId));
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        video.src = url;
        if (startSec > 0) {
          video.addEventListener(
            'loadedmetadata',
            () => {
              try {
                video.currentTime = startSec;
              } catch {
                /* ignore */
              }
            },
            { once: true },
          );
        }
        video.play().catch(() => {});
      }

      if (sub && sub.DeliveryMethod === 'External' && sub.DeliveryUrl) loadSubtitles(api.absolute(sub.DeliveryUrl));
      const p = payload();
      if (p) api.reportStart(p).catch(() => {});
      setPlaybackActive(true);
    } catch (e) {
      if (loadId !== loadIdRef.current) return;
      setBuffering(false);
      setError(errorMessage(e));
    }
  };

  /** Repli automatique : lecture directe → remux → transcodage complet. */
  const fallback = (reason: string) => {
    const it = live.current.item;
    const v = videoRef.current;
    if (!it) return;
    const s = sessionRef.current;
    const level = s ? s.level : failLevelRef.current;
    const pos = v && v.currentTime > 1 ? v.currentTime : startPosRef.current;
    if (level >= 2) {
      endSession(true);
      teardownMedia();
      setBuffering(false);
      setError(t('player.failed', { reason }));
      return;
    }
    console.warn(`[player] échec (${reason}) → nouvel essai au niveau ${level + 1}`);
    failLevelRef.current = level + 1;
    start({ item: it, startSec: pos, audioIndex: live.current.audioIndex, subIndex: live.current.subIndex, level: level + 1 });
  };

  const onHlsError = (data: ErrorData, loadId: number) => {
    if (loadId !== loadIdRef.current || !data.fatal) return;
    const hls = hlsRef.current;
    if (!hls) return;
    const r = retryRef.current;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && r.net < 4) {
      r.net++;
      window.setTimeout(() => {
        if (hlsRef.current === hls) hls.startLoad();
      }, 1000 * r.net);
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && r.media < 2) {
      r.media++;
      if (r.media === 2) hls.swapAudioCodec();
      hls.recoverMediaError();
      return;
    }
    fallback(data.details);
  };

  /** Redémarre au même endroit (changement de piste audio, de qualité…). */
  const restart = (changes: { audioIndex?: number; subIndex?: number } = {}) => {
    const it = live.current.item;
    const v = videoRef.current;
    if (!it) return;
    const pos = v && v.currentTime > 0 ? v.currentTime : startPosRef.current;
    start({
      item: it,
      startSec: pos,
      audioIndex: changes.audioIndex !== undefined ? changes.audioIndex : live.current.audioIndex,
      subIndex: changes.subIndex !== undefined ? changes.subIndex : live.current.subIndex,
      level: failLevelRef.current,
    });
  };

  // ---------------------------------------------------------------------------
  // Commandes
  // ---------------------------------------------------------------------------

  const poke = () => {
    if (!live.current.controls) {
      setControls(true);
      live.current.controls = true;
    }
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(
      () => {
        const v = videoRef.current;
        if (v && !v.paused && !live.current.panel) {
          setControls(false);
          live.current.controls = false;
        }
      },
      3500,
    );
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekTo = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = (isFinite(v.duration) && v.duration) || duration || Infinity;
    const target = Math.max(0, Math.min(sec, max - 0.5));
    try {
      v.currentTime = target;
      setTime(target);
    } catch {
      /* ignore */
    }
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (v) seekTo(v.currentTime + delta);
  };

  const changeVolume = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = Math.max(0, Math.min(1, Math.round((v.volume + delta) * 100) / 100));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  };

  const goNext = () => {
    const n = live.current.nextEp;
    if (n) navigate(`/play/${n.Id}`, { replace: true });
  };

  const selectAudio = (index: number) => {
    setPanel(null);
    if (index === live.current.audioIndex) return;
    setAudioIndex(index);
    live.current.audioIndex = index;
    restart({ audioIndex: index });
  };

  const selectSubtitle = (index: number) => {
    setPanel(null);
    if (index === live.current.subIndex) return;
    const s = sessionRef.current;
    setSubIndex(index);
    live.current.subIndex = index;
    const stream = streams.find((x) => x.Type === 'Subtitle' && x.Index === index);
    const needsBurn = !!stream && stream.DeliveryMethod !== 'External';
    if ((s && s.burnedSub) || needsBurn) {
      restart({ subIndex: index });
      return;
    }
    if (s) s.subIndex = index;
    subLoadRef.current++;
    setCues([]);
    setCueHtml('');
    if (stream && stream.DeliveryUrl) loadSubtitles(api.absolute(stream.DeliveryUrl));
    reportProgress();
  };

  const selectBitrate = (value: number) => {
    setPanel(null);
    if (value === live.current.bitrate) return;
    setBitrate(value);
    live.current.bitrate = value;
    updateSettings({ maxBitrate: value });
    restart();
  };

  const retry = () => {
    const it = live.current.item;
    if (!it) return;
    start({
      item: it,
      startSec: startPosRef.current,
      audioIndex: live.current.audioIndex,
      subIndex: live.current.subIndex,
      level: failLevelRef.current,
    });
  };

  /**
   * Mobile : un appui affiche ou masque les commandes ; un double appui sur la moitié gauche / droite
   * recule / avance de 10 s (cumulable en enchaînant les appuis), comme les applications de streaming.
   */
  const tapRef = useRef<{ time: number; timer: number; streak: number }>({ time: 0, timer: 0, streak: 0 });
  const [seekFlash, setSeekFlash] = useState<{ id: number; delta: number } | null>(null);
  const flashTimer = useRef(0);
  const onSurfaceTap = (e: ReactMouseEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? -1 : 1;
    window.clearTimeout(tap.timer);
    if (now - tap.time < 300) {
      // Double appui (ou appuis suivants d'une série) : saut de 10 s.
      tap.time = now;
      tap.streak = seekFlash && Math.sign(seekFlash.delta) === side ? tap.streak + 1 : 1;
      seekBy(side * 10);
      setSeekFlash({ id: now, delta: side * 10 * tap.streak });
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setSeekFlash(null), 700);
      return;
    }
    tap.time = now;
    tap.streak = 0;
    tap.timer = window.setTimeout(() => {
      if (live.current.controls) {
        window.clearTimeout(hideTimerRef.current);
        setControls(false);
        live.current.controls = false;
      } else poke();
    }, 300);
  };

  /** Affiche les commandes et place le focus sur Lecture / Pause (télécommande). */
  const focusPlay = () => {
    poke();
    requestAnimationFrame(() => playBtnRef.current && playBtnRef.current.focus({ preventScroll: true }));
  };

  const actions = useRef({ start, endSession, teardownMedia, onHlsError, fallback, poke, focusPlay, togglePlay, seekBy, changeVolume, toggleFullscreen, exit, goNext, setPanel, reportProgress });
  actions.current = { start, endSession, teardownMedia, onHlsError, fallback, poke, focusPlay, togglePlay, seekBy, changeVolume, toggleFullscreen, exit, goNext, setPanel, reportProgress };

  // ---------------------------------------------------------------------------
  // Effets
  // ---------------------------------------------------------------------------

  // Chargement de l'élément puis démarrage.
  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(null);
    setSegments([]);
    setNextEp(null);
    setNextDismissed(false);
    setPanel(null);
    setTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setBuffering(true);
    setStreams([]);
    setMethod(null);
    skippedRef.current = new Set();
    failLevelRef.current = 0;

    (async () => {
      try {
        const it = await api.item(id);
        if (cancelled) return;
        live.current.item = it;
        setItem(it);
        const src = it.MediaSources && it.MediaSources[0];
        const t = searchParams.get('t');
        const resumeTicks = (it.UserData && it.UserData.PlaybackPositionTicks) || 0;
        const startSec = t != null ? Math.max(0, Number(t) || 0) : resumeTicks / TPS;
        const a = src && src.DefaultAudioStreamIndex != null ? src.DefaultAudioStreamIndex : undefined;
        const s = src && src.DefaultSubtitleStreamIndex != null ? src.DefaultSubtitleStreamIndex : -1;
        setAudioIndex(a);
        setSubIndex(s);
        live.current.audioIndex = a;
        live.current.subIndex = s;
        await actions.current.start({ item: it, startSec, audioIndex: a, subIndex: s, level: 0 });
        if (cancelled) return;
        api.segments(it.Id).then((r) => !cancelled && setSegments(r));
        if (it.Type === 'Episode' && it.SeriesId) {
          api
            .episodes(it.SeriesId, { startItemId: it.Id, limit: 2 })
            .then((r) => {
              if (!cancelled) setNextEp((r.Items || []).find((x) => x.Id !== it.Id) || null);
            })
            .catch(() => {});
        }
      } catch (e) {
        if (!cancelled) {
          setBuffering(false);
          setError(errorMessage(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      loadIdRef.current++;
      actions.current.endSession(true);
      actions.current.teardownMedia();
      setPlaybackActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Rapport de progression toutes les 10 s.
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) actions.current.reportProgress();
    }, 10000);
    return () => window.clearInterval(t);
  }, []);

  // Rapport final si la fenêtre est fermée pendant la lecture.
  useEffect(() => {
    const onUnload = () => actions.current.endSession(true);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Plein écran.
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Sous-titres synchronisés à l'image.
  useEffect(() => {
    if (!cues.length) {
      setCueHtml('');
      return;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const html = activeCueHtml(cues, v.currentTime);
        if (html !== last) {
          last = html;
          setCueHtml(html);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues]);

  // Clavier / télécommande.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      const v = videoRef.current;
      if (!v) return;
      const wasVisible = live.current.controls;
      const panelOpen = !!live.current.panel;
      const key = keyName(e);
      const code = e.keyCode;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (isBackKey(e) || key === 'Escape' || key === 'Backspace') {
        if (key === 'Escape' && document.fullscreenElement && !panelOpen) return;
        stop();
        if (panelOpen) a.setPanel(null);
        else a.exit();
        return;
      }
      a.poke();
      if (key === ' ' || key === 'k' || key === 'K' || key === 'MediaPlayPause') {
        stop();
        a.togglePlay();
        return;
      }
      if (key === 'MediaPlay') {
        stop();
        v.play().catch(() => {});
        return;
      }
      if (key === 'MediaPause') {
        stop();
        v.pause();
        return;
      }
      if (key === 'MediaStop') {
        stop();
        a.exit();
        return;
      }
      if (key === 'MediaFastForward') {
        stop();
        a.seekBy(30);
        return;
      }
      if (key === 'MediaRewind') {
        stop();
        a.seekBy(-30);
        return;
      }
      if (key === 'MediaTrackNext') {
        stop();
        a.goNext();
        return;
      }
      if (key === 'MediaTrackPrevious') {
        stop();
        a.seekBy(-Infinity);
        return;
      }
      if (panelOpen) return; // la navigation spatiale gère le panneau
      const onScrubber = !!(document.activeElement as HTMLElement | null)?.dataset?.scrubber;
      if (isTV) {
        // Télécommande : commandes masquées → ◀ ▶ avancent / reculent, les autres touches les affichent.
        // Commandes affichées → les flèches se déplacent entre les boutons (sauf ◀ ▶ sur la barre de progression).
        const arrow = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
        if (!wasVisible) {
          if (key === 'ArrowLeft' || key === 'ArrowRight') {
            stop();
            a.seekBy(key === 'ArrowLeft' ? -10 : 10);
          } else if (arrow || key === 'Enter') {
            stop();
            a.focusPlay();
          }
          return;
        }
        if (onScrubber && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          stop();
          a.seekBy(key === 'ArrowLeft' ? -10 : 10);
        }
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        stop();
        a.seekBy(key === 'ArrowLeft' ? -10 : 10);
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        stop();
        a.changeVolume(key === 'ArrowUp' ? 0.05 : -0.05);
        return;
      }
      if (key === 'Enter' && !wasVisible) {
        stop();
        a.togglePlay();
        return;
      }
      if (key === 'f' || key === 'F') {
        stop();
        a.toggleFullscreen();
        return;
      }
      if (key === 'm' || key === 'M') {
        stop();
        v.muted = !v.muted;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Intro / générique / épisode suivant
  // ---------------------------------------------------------------------------

  const dur = duration || (item && item.RunTimeTicks ? item.RunTimeTicks / TPS : 0);
  const skipSeg = segments.find(
    (s) => (s.Type === 'Intro' || s.Type === 'Recap') && time >= s.StartTicks / TPS && time < s.EndTicks / TPS - 1,
  );
  const outro = segments.find((s) => s.Type === 'Outro');
  const creditsStart = outro ? outro.StartTicks / TPS : dur > 300 ? dur - 30 : Infinity;
  const showNext = !!nextEp && !nextDismissed && !error && time > 0 && time >= creditsStart;

  useEffect(() => {
    if (!skipSeg || !settings.autoSkipIntro || skippedRef.current.has(skipSeg.Id)) return;
    skippedRef.current.add(skipSeg.Id);
    seekTo(skipSeg.EndTicks / TPS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipSeg && skipSeg.Id, settings.autoSkipIntro]);

  useEffect(() => {
    setCountdown(showNext && settings.autoplayNext ? 10 : null);
  }, [showNext, settings.autoplayNext]);

  useEffect(() => {
    if (countdown == null || paused) return;
    if (countdown <= 0) {
      actions.current.goNext();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c == null ? c : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, paused]);

  // ---------------------------------------------------------------------------
  // Aperçus (trickplay)
  // ---------------------------------------------------------------------------

  const trick = useMemo<Trick | null>(() => {
    if (!item || !item.Trickplay) return null;
    const msid = item.MediaSources && item.MediaSources[0] ? item.MediaSources[0].Id : Object.keys(item.Trickplay)[0];
    const map = item.Trickplay[msid] || item.Trickplay[Object.keys(item.Trickplay)[0]];
    if (!map) return null;
    const widths = Object.keys(map)
      .map(Number)
      .sort((a, b) => a - b);
    if (!widths.length) return null;
    const w = widths.find((x) => x >= 240) || widths[widths.length - 1];
    return { ...map[String(w)], width: w, msid };
  }, [item]);

  const thumbStyle = (sec: number): CSSProperties | null => {
    if (!trick || !item || !trick.Interval) return null;
    const idx = Math.min(trick.ThumbnailCount - 1, Math.floor((sec * 1000) / trick.Interval));
    const per = trick.TileWidth * trick.TileHeight;
    const sheet = Math.floor(idx / per);
    const local = idx % per;
    const col = local % trick.TileWidth;
    const row = Math.floor(local / trick.TileWidth);
    return {
      width: trick.Width,
      height: trick.Height,
      backgroundImage: `url("${api.trickplayUrl(item.Id, trick.width, sheet, trick.msid)}")`,
      backgroundPosition: `-${col * trick.Width}px -${row * trick.Height}px`,
    };
  };

  // ---------------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------------

  const title = item ? (item.Type === 'Episode' ? item.SeriesName : item.Name) : '';
  const subtitle = item
    ? item.Type === 'Episode'
      ? [episodeCode(item), item.Name].filter(Boolean).join(' · ')
      : item.ProductionYear
        ? String(item.ProductionYear)
        : ''
    : '';

  const onVideoError = () => {
    if (hlsRef.current) return; // hls.js gère ses propres erreurs
    const v = videoRef.current;
    if (!v || !v.error || !sessionRef.current || !v.currentSrc) return;
    fallback(`code ${v.error.code}`);
  };

  const onWaiting = () => {
    setBuffering(true);
    window.clearTimeout(stallTimerRef.current);
    // Lecture directe bloquée trop longtemps (débit insuffisant) → on bascule en transcodage.
    stallTimerRef.current = window.setTimeout(() => {
      const s = sessionRef.current;
      const v = videoRef.current;
      if (s && s.playMethod === 'DirectPlay' && v && !v.paused && v.readyState < 3) actions.current.fallback('stall');
    }, 25000);
  };

  const onPlaying = () => {
    setBuffering(false);
    window.clearTimeout(stallTimerRef.current);
    retryRef.current = { net: 0, media: 0 };
  };

  const onProgressEvt = () => {
    const v = videoRef.current;
    if (!v) return;
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) {
        setBufferedEnd(b.end(i));
        return;
      }
    }
  };

  const audios = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  const videoStream = streams.find((s) => s.Type === 'Video');

  return (
    <div
      className={`player ${controls ? 'show-controls' : 'hide-controls'} ${buffering ? 'is-buffering' : ''}`}
      // Mobile : les commandes s'affichent / se masquent d'un appui (voir onSurfaceTap), pas à chaque contact.
      onMouseMove={isMobile ? undefined : () => poke()}
      onTouchStart={isMobile ? undefined : () => poke()}
    >
      <video
        ref={setVideoEl}
        className="player__video"
        playsInline
        preload="auto"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d) && d > 0) setDuration(d);
        }}
        onWaiting={onWaiting}
        onSeeking={() => setBuffering(true)}
        onSeeked={() => {
          setBuffering(false);
          reportProgress();
        }}
        onPlaying={onPlaying}
        onCanPlay={() => setBuffering(false)}
        onPlay={() => {
          setPaused(false);
          poke();
          reportProgress();
        }}
        onPause={() => {
          setPaused(true);
          setControls(true);
          live.current.controls = true;
          reportProgress();
        }}
        onEnded={() => {
          if (live.current.nextEp && getSettings().autoplayNext) goNext();
          else exit();
        }}
        onError={onVideoError}
        onProgress={onProgressEvt}
        onVolumeChange={(e) => {
          const v = e.currentTarget;
          setVolume(v.volume);
          setMuted(v.muted);
          updateSettings({ volume: v.volume, muted: v.muted });
        }}
      />

      {isMobile ? (
        <div className="player__click" onClick={onSurfaceTap} />
      ) : (
        <div className="player__click" onClick={togglePlay} onDoubleClick={toggleFullscreen} />
      )}

      {seekFlash && (
        <div key={seekFlash.id} className={`player__seek-flash player__seek-flash--${seekFlash.delta < 0 ? 'left' : 'right'}`}>
          {seekFlash.delta < 0 ? <I.Rewind10 /> : <I.Forward10 />}
          <span>{seekFlash.delta < 0 ? '−' : '+'}{Math.abs(seekFlash.delta)} s</span>
        </div>
      )}

      {cueHtml && (
        <div className="player__subs" style={subtitleVars(settings)}>
          <span dangerouslySetInnerHTML={{ __html: cueHtml }} />
        </div>
      )}

      {buffering && !error && (
        <div className="player__center-spinner">
          <Spinner size="lg" />
        </div>
      )}

      <div className="player__chrome" data-nav-hidden={controls ? undefined : 'true'}>
        <div className="player__top">
          <button className="pbtn" onClick={exit} aria-label={t('common.back')}>
            <I.ArrowLeft />
          </button>
          <div className="player__titles">
            <div className="player__title">{title}</div>
            {subtitle && <div className="player__subtitle">{subtitle}</div>}
          </div>
        </div>

        <div className="player__middle">
          <button className="pbtn pbtn--lg" onClick={() => seekBy(-10)} aria-label={t('player.rewind')}>
            <I.Rewind10 />
          </button>
          <button className="pbtn pbtn--xl" ref={playBtnRef} onClick={togglePlay} aria-label={paused ? t('player.play') : t('player.pause')}>
            {paused ? <I.Play /> : <I.Pause />}
          </button>
          <button className="pbtn pbtn--lg" onClick={() => seekBy(10)} aria-label={t('player.forward')}>
            <I.Forward10 />
          </button>
        </div>

        <div className="player__bottom">
          <div className="player__timeline">
            <span className="player__time">{formatClock(time)}</span>
            <Scrubber time={time} duration={dur} buffered={bufferedEnd} onSeek={seekTo} thumb={thumbStyle} />
            <span className="player__time">-{formatClock(Math.max(0, dur - time))}</span>
          </div>
          <div className="player__bar">
            {/* Sur TV, le volume se règle avec la télécommande. */}
            <div className="player__bar-side">
              {!isTV && !isMobile && (
              <button
                className="pbtn"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) v.muted = !v.muted;
                }}
                aria-label={muted ? t('player.unmute') : t('player.mute')}
              >
                {muted || volume === 0 ? <I.VolumeOff /> : <I.Volume />}
              </button>
              )}
              {!isTV && !isMobile && (
              <input
                className="volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={{ '--v': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
                aria-label={t('player.volume')}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.muted = false;
                  v.volume = Number(e.target.value);
                }}
              />
              )}
            </div>
            <div className="player__bar-side">
              {nextEp && (
                <button className="pbtn" onClick={goNext} aria-label={t('player.nextEpisode')} title={t('player.nextEpisode')}>
                  <I.Next />
                </button>
              )}
              {item && item.Type === 'Episode' && (
                <button
                  className={`pbtn ${panel === 'episodes' ? 'is-on' : ''}`}
                  onClick={() => setPanel(panel === 'episodes' ? null : 'episodes')}
                  aria-label={t('player.episodes')}
                  title={t('player.episodes')}
                >
                  <I.Episodes />
                </button>
              )}
              <button
                className={`pbtn ${panel === 'tracks' ? 'is-on' : ''}`}
                onClick={() => setPanel(panel === 'tracks' ? null : 'tracks')}
                aria-label={t('player.audioSubs')}
                title={t('player.audioSubs')}
              >
                <I.Subtitles />
              </button>
              <button
                className={`pbtn ${panel === 'quality' ? 'is-on' : ''}`}
                onClick={() => setPanel(panel === 'quality' ? null : 'quality')}
                aria-label={t('player.quality')}
                title={t('player.quality')}
              >
                <I.Sliders />
              </button>
              {!isTV && !isMobile && (
                <button className="pbtn" onClick={toggleFullscreen} aria-label={t('player.fullscreen')} title={t('player.fullscreen')}>
                  {fullscreen ? <I.ExitFullscreen /> : <I.Fullscreen />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {skipSeg && !error && !settings.autoSkipIntro && (
        <button className="player__skip" onClick={() => seekTo(skipSeg.EndTicks / TPS)}>
          {skipSeg.Type === 'Recap' ? t('player.skipRecap') : t('player.skipIntro')}
        </button>
      )}

      {showNext && nextEp && (
        <NextCard
          ep={nextEp}
          countdown={countdown}
          onPlay={goNext}
          onDismiss={() => {
            setNextDismissed(true);
            setCountdown(null);
          }}
        />
      )}

      {panel && <div className="player__panel-backdrop" onClick={() => setPanel(null)} />}

      {panel === 'tracks' && (
        <div className="ppanel" data-nav-scope>
          <PanelHead title={t('player.audioSubs')} onClose={() => setPanel(null)} />
          <div className="ppanel__cols">
            <div className="ppanel__col">
              <h4>{t('player.audio')}</h4>
              {audios.length === 0 && <div className="ppanel__info">{t('player.noTrack')}</div>}
              {audios.map((a) => (
                <Option key={a.Index} active={a.Index === audioIndex} onClick={() => selectAudio(a.Index)}>
                  {trackLabel(a)}
                </Option>
              ))}
            </div>
            <div className="ppanel__col">
              <h4>{t('player.subtitles')}</h4>
              <Option active={subIndex === -1} onClick={() => selectSubtitle(-1)}>
                {t('player.off')}
              </Option>
              {subs.map((s) => (
                <Option key={s.Index} active={s.Index === subIndex} onClick={() => selectSubtitle(s.Index)}>
                  {trackLabel(s)}
                  {s.DeliveryMethod === 'Encode' && <small> · {t('player.burned')}</small>}
                </Option>
              ))}
            </div>
          </div>
        </div>
      )}

      {panel === 'quality' && (
        <div className="ppanel" data-nav-scope>
          <PanelHead title={t('player.quality')} onClose={() => setPanel(null)} />
          <div className="ppanel__list">
            {bitrateOptions().map((b) => (
              <Option key={b.value} active={b.value === bitrate} onClick={() => selectBitrate(b.value)}>
                {b.label}
              </Option>
            ))}
          </div>
          <div className="ppanel__info">
            {method && t(METHOD_KEY[method])}
            {videoStream && videoStream.Width ? ` · ${videoStream.Width}×${videoStream.Height}` : ''}
            {videoStream && videoStream.Codec ? ` · ${videoStream.Codec.toUpperCase()}` : ''}
          </div>
        </div>
      )}

      {panel === 'episodes' && item && item.SeriesId && (
        <EpisodesPanel
          seriesId={item.SeriesId}
          seasonId={item.SeasonId}
          currentId={item.Id}
          onClose={() => setPanel(null)}
          onPick={(epId) => {
            setPanel(null);
            if (epId !== item.Id) navigate(`/play/${epId}?t=0`, { replace: true });
          }}
        />
      )}

      {error && (
        <div className="player__error" data-nav-scope>
          <h2>{t('player.cannotPlay')}</h2>
          <p>{error}</p>
          <div className="row">
            <button className="btn btn--primary" onClick={retry} autoFocus>
              {t('common.retry')}
            </button>
            <button className="btn btn--ghost" onClick={exit}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sous-composants
// -----------------------------------------------------------------------------

function PanelHead({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <div className="ppanel__head">
      <h3>{title}</h3>
      <button className="pbtn" onClick={onClose} aria-label={t('common.close')}>
        <I.Close />
      </button>
    </div>
  );
}

function Option({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && ref.current) ref.current.focus({ preventScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button ref={ref} className={`ppanel__opt ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="ppanel__check">{active && <I.Check />}</span>
      <span>{children}</span>
    </button>
  );
}

function Scrubber({
  time,
  duration,
  buffered,
  onSeek,
  thumb,
}: {
  time: number;
  duration: number;
  buffered: number;
  onSeek(sec: number): void;
  thumb(sec: number): CSSProperties | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const posAt = (clientX: number) => {
    const el = ref.current;
    if (!el || !duration) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

  const shown = drag != null ? drag : time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const bpct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const preview = drag != null ? drag : hover;
  const tStyle = preview != null ? thumb(preview) : null;

  return (
    <div
      ref={ref}
      className="scrubber"
      tabIndex={0}
      role="slider"
      data-scrubber="true"
      aria-label={t('player.position')}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatClock(time)}
      onPointerMove={(e) => {
        const s = posAt(e.clientX);
        setHover(s);
        if (drag != null) setDrag(s);
      }}
      onPointerLeave={() => {
        if (drag == null) setHover(null);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(posAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (drag != null) onSeek(posAt(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="scrubber__track">
        <div className="scrubber__buffer" style={{ width: `${bpct}%` }} />
        <div className="scrubber__fill" style={{ width: `${pct}%` }} />
        <div className="scrubber__knob" style={{ left: `${pct}%` }} />
      </div>
      {preview != null && duration > 0 && (
        <div className="scrubber__preview" style={{ left: `clamp(90px, ${(preview / duration) * 100}%, calc(100% - 90px))` }}>
          {tStyle && <div className="scrubber__thumb" style={tStyle} />}
          <span>{formatClock(preview)}</span>
        </div>
      )}
    </div>
  );
}

function NextCard({
  ep,
  countdown,
  onPlay,
  onDismiss,
}: {
  ep: BaseItem;
  countdown: number | null;
  onPlay(): void;
  onDismiss(): void;
}) {
  const img = landscapeUrl(ep, 480);
  return (
    <div className="player__next" data-nav-scope>
      <div className="player__next-thumb">{img && <img src={img} alt="" />}</div>
      <div className="player__next-info">
        <small>{t('player.nextEpisode')}</small>
        <strong>
          {episodeCode(ep)} · {ep.Name}
        </strong>
        <div className="player__next-actions">
          <button className="btn btn--primary btn--sm" onClick={onPlay}>
            <I.Play /> {countdown != null ? t('player.playIn', { n: countdown }) : t('player.playNow')}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onDismiss}>
            {t('player.watchCredits')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EpisodesPanel({
  seriesId,
  seasonId,
  currentId,
  onClose,
  onPick,
}: {
  seriesId: string;
  seasonId?: string;
  currentId: string;
  onClose(): void;
  onPick(id: string): void;
}) {
  const [eps, setEps] = useState<BaseItem[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .episodes(seriesId, { seasonId })
      .then((r) => setEps(r.Items || []))
      .catch(() => setEps([]));
  }, [seriesId, seasonId]);

  useEffect(() => {
    if (!eps) return;
    const cur = listRef.current && (listRef.current.querySelector('.is-current') as HTMLElement | null);
    if (cur) {
      cur.focus({ preventScroll: true });
      cur.scrollIntoView({ block: 'center' });
    }
  }, [eps]);

  return (
    <div className="ppanel ppanel--episodes" data-nav-scope>
      <PanelHead title={eps && eps[0] && eps[0].SeasonName ? eps[0].SeasonName : t('player.episodes')} onClose={onClose} />
      {eps === null ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : (
        <div className="ppanel__list" ref={listRef}>
          {eps.map((ep) => {
            const img = landscapeUrl(ep, 320);
            const pct = (ep.UserData && ep.UserData.PlayedPercentage) || 0;
            return (
              <button key={ep.Id} className={`pep ${ep.Id === currentId ? 'is-current' : ''}`} onClick={() => onPick(ep.Id)}>
                <div className="pep__thumb">
                  {img && <img src={img} alt="" loading="lazy" />}
                  {pct > 0 && pct < 100 && (
                    <div className="card__progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="pep__title">
                    {ep.IndexNumber != null ? `${ep.IndexNumber}. ` : ''}
                    {ep.Name}
                  </div>
                  <div className="pep__meta">
                    {formatRuntime(ep.RunTimeTicks)}
                    {ep.UserData && ep.UserData.Played ? ` · ${t('common.watched')}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
