// Construit le "DeviceProfile" envoyé à Jellyfin en détectant ce que le moteur vidéo sait décoder.
// Le serveur s'en sert pour choisir : lecture directe, remux (direct stream) ou transcodage.

let probe: HTMLVideoElement | null = null;

function canPlay(type: string): boolean {
  try {
    probe = probe || document.createElement('video');
    if (probe.canPlayType(type).replace(/no/, '')) return true;
  } catch {
    /* ignore */
  }
  try {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
  } catch {
    return false;
  }
}

export interface Capabilities {
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  vp8: boolean;
  aac: boolean;
  mp3: boolean;
  opus: boolean;
  flac: boolean;
  vorbis: boolean;
  ac3: boolean;
  eac3: boolean;
  mkv: boolean;
}

let cached: Capabilities | null = null;

export function getCapabilities(): Capabilities {
  if (cached) return cached;
  cached = {
    h264: canPlay('video/mp4; codecs="avc1.640029"') || canPlay('video/mp4; codecs="avc1.42E01E"'),
    hevc:
      canPlay('video/mp4; codecs="hvc1.1.6.L120.90"') ||
      canPlay('video/mp4; codecs="hev1.1.6.L120.90"') ||
      canPlay('video/mp4; codecs="hvc1.2.4.L153.B0"'),
    av1: canPlay('video/mp4; codecs="av01.0.08M.08"'),
    vp9: canPlay('video/webm; codecs="vp9"'),
    vp8: canPlay('video/webm; codecs="vp8"'),
    aac: true,
    mp3: canPlay('audio/mpeg') || canPlay('audio/mp4; codecs="mp4a.6B"'),
    opus: canPlay('audio/ogg; codecs="opus"') || canPlay('audio/webm; codecs="opus"'),
    flac: canPlay('audio/flac') || canPlay('audio/mp4; codecs="flac"'),
    vorbis: canPlay('audio/ogg; codecs="vorbis"') || canPlay('audio/webm; codecs="vorbis"'),
    ac3: canPlay('audio/mp4; codecs="ac-3"'),
    eac3: canPlay('audio/mp4; codecs="ec-3"'),
    mkv: canPlay('video/x-matroska; codecs="avc1.640029"'),
  };
  return cached;
}

export function buildDeviceProfile(maxBitrate: number) {
  const c = getCapabilities();
  const mp4Video = ['h264', c.hevc && 'hevc', c.av1 && 'av1'].filter(Boolean).join(',');
  const mp4Audio = ['aac', c.mp3 && 'mp3', c.ac3 && 'ac3', c.eac3 && 'eac3', c.flac && 'flac', c.opus && 'opus']
    .filter(Boolean)
    .join(',');
  const webmVideo = [c.vp8 && 'vp8', c.vp9 && 'vp9', c.av1 && 'av1'].filter(Boolean).join(',');
  const webmAudio = [c.vorbis && 'vorbis', c.opus && 'opus'].filter(Boolean).join(',');
  const mkvVideo = ['h264', c.hevc && 'hevc', c.av1 && 'av1', c.vp9 && 'vp9'].filter(Boolean).join(',');

  const directPlay: Record<string, unknown>[] = [
    { Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: mp4Video, AudioCodec: mp4Audio },
  ];
  if (webmVideo) directPlay.push({ Container: 'webm', Type: 'Video', VideoCodec: webmVideo, AudioCodec: webmAudio });
  if (c.mkv) directPlay.push({ Container: 'mkv', Type: 'Video', VideoCodec: mkvVideo, AudioCodec: mp4Audio + ',vorbis' });
  directPlay.push({ Container: 'mp3', Type: 'Audio' }, { Container: 'aac,m4a', Type: 'Audio' });

  // HLS : fMP4 si HEVC disponible (permet la copie du flux HEVC), sinon MPEG-TS H.264, le plus universel.
  const hlsAudio = ['aac', c.mp3 && 'mp3', c.ac3 && 'ac3', c.eac3 && 'eac3'].filter(Boolean).join(',');
  const transcoding = [
    c.hevc
      ? {
          Container: 'mp4',
          Type: 'Video',
          AudioCodec: hlsAudio,
          VideoCodec: 'hevc,h264',
          Context: 'Streaming',
          Protocol: 'hls',
          MaxAudioChannels: '6',
          MinSegments: '1',
          BreakOnNonKeyFrames: true,
        }
      : {
          Container: 'ts',
          Type: 'Video',
          AudioCodec: hlsAudio,
          VideoCodec: 'h264',
          Context: 'Streaming',
          Protocol: 'hls',
          MaxAudioChannels: '6',
          MinSegments: '1',
          BreakOnNonKeyFrames: true,
        },
    { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '2' },
  ];

  const codecProfiles: Record<string, unknown>[] = [
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
        { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
      ],
    },
  ];
  if (c.hevc) {
    codecProfiles.push({
      Type: 'Video',
      Codec: 'hevc',
      Conditions: [
        { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
        { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main|main 10', IsRequired: false },
      ],
    });
  }

  return {
    Name: 'JellyMax',
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: 200_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: transcoding,
    ContainerProfiles: [],
    CodecProfiles: codecProfiles,
    // Sous-titres texte livrés en WebVTT (rendus par l'appli), sous-titres image incrustés par le serveur.
    SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
  };
}
