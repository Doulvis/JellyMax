import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, deviceId } from '../api/client';
import { getCapabilities } from '../api/deviceProfile';
import type { PublicSystemInfo } from '../api/types';
import { AvatarPicker } from '../components/AvatarPicker';
import { Avatar, Dropdown, Switch } from '../components/Common';
import { Pencil } from '../components/Icons';
import { bitrateOptions, t } from '../i18n';
import { APP_VERSION, platformLabel } from '../platform';
import { useAuth } from '../state/auth';
import {
  SUBTITLE_DEFAULTS,
  updateSettings,
  useSettings,
  type Language,
  type SubtitleBackground,
  type SubtitleColor,
  type SubtitleEdge,
  type SubtitleFont,
  type SubtitlePosition,
  type SubtitleSize,
} from '../state/settings';
import { SUBTITLE_COLORS, subtitleVars } from '../utils/subtitles';

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <strong>{title}</strong>
        {desc && <span>{desc}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  );
}

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];

const SIZE_KEYS = { small: 'sub.size.small', medium: 'sub.size.medium', large: 'sub.size.large', xlarge: 'sub.size.xlarge' } as const;
const COLOR_KEYS = {
  white: 'sub.color.white',
  yellow: 'sub.color.yellow',
  cyan: 'sub.color.cyan',
  green: 'sub.color.green',
  magenta: 'sub.color.magenta',
} as const;
const BG_KEYS = { none: 'sub.bg.none', translucent: 'sub.bg.translucent', opaque: 'sub.bg.opaque' } as const;
const EDGE_KEYS = { shadow: 'sub.edge.shadow', outline: 'sub.edge.outline', none: 'sub.edge.none' } as const;
const POS_KEYS = { low: 'sub.position.low', medium: 'sub.position.medium', high: 'sub.position.high' } as const;
const FONT_KEYS = { sans: 'sub.font.sans', serif: 'sub.font.serif' } as const;

function options<K extends string>(map: Record<K, Parameters<typeof t>[0]>) {
  return (Object.keys(map) as K[]).map((k) => ({ value: k, label: t(map[k]) }));
}

export default function SettingsPage() {
  const s = useSettings();
  const { session, logout, leaveProfile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<PublicSystemInfo | null>(null);
  const [editAvatar, setEditAvatar] = useState(false);
  const caps = getCapabilities();

  useEffect(() => {
    api
      .publicInfo(api.baseUrl)
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!session) return null;

  const codecs = [
    'H.264',
    caps.hevc && 'HEVC',
    caps.av1 && 'AV1',
    caps.vp9 && 'VP9',
    'AAC',
    caps.ac3 && 'AC3',
    caps.eac3 && 'E-AC3',
    caps.flac && 'FLAC',
    caps.opus && 'Opus',
    caps.mkv && 'MKV',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="page">
      <h1 className="page__title">{t('settings.title')}</h1>
      <div className="settings">
        <section className="settings__section">
          <h2>{t('settings.language')}</h2>
          <Row title={t('settings.language')} desc={t('settings.languageDesc')}>
            <Dropdown align="right" value={s.language} options={LANGUAGES} onChange={(v) => updateSettings({ language: v })} />
          </Row>
        </section>

        <section className="settings__section">
          <h2>{t('settings.playback')}</h2>
          <Row title={t('settings.quality')} desc={t('settings.qualityDesc')}>
            <Dropdown align="right" value={s.maxBitrate} options={bitrateOptions()} onChange={(v) => updateSettings({ maxBitrate: v })} />
          </Row>
          <Row title={t('settings.autoplay')} desc={t('settings.autoplayDesc')}>
            <Switch label={t('settings.autoplay')} on={s.autoplayNext} onChange={(v) => updateSettings({ autoplayNext: v })} />
          </Row>
          <Row title={t('settings.skipIntro')} desc={t('settings.skipIntroDesc')}>
            <Switch label={t('settings.skipIntro')} on={s.autoSkipIntro} onChange={(v) => updateSettings({ autoSkipIntro: v })} />
          </Row>
        </section>

        <section className="settings__section">
          <div className="settings__section-head">
            <h2>{t('settings.subtitles')}</h2>
            <button className="link-btn" onClick={() => updateSettings({ ...SUBTITLE_DEFAULTS })}>
              {t('sub.reset')}
            </button>
          </div>

          {/* Aperçu en direct */}
          <div className="sub-preview">
            <div className="sub-preview__scene" />
            <div className="player__subs" style={subtitleVars(s)}>
              <span>{t('sub.preview')}</span>
            </div>
          </div>

          <Row title={t('sub.size')}>
            <Dropdown align="right" value={s.subtitleSize} options={options<SubtitleSize>(SIZE_KEYS)} onChange={(v) => updateSettings({ subtitleSize: v })} />
          </Row>
          <Row title={t('sub.color')} desc={t(COLOR_KEYS[s.subtitleColor])}>
            <div className="swatches" role="radiogroup" aria-label={t('sub.color')}>
              {(Object.keys(SUBTITLE_COLORS) as SubtitleColor[]).map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={s.subtitleColor === c}
                  aria-label={t(COLOR_KEYS[c])}
                  title={t(COLOR_KEYS[c])}
                  className={`swatch ${s.subtitleColor === c ? 'is-active' : ''}`}
                  style={{ background: SUBTITLE_COLORS[c] }}
                  onClick={() => updateSettings({ subtitleColor: c })}
                />
              ))}
            </div>
          </Row>
          <Row title={t('sub.bg')}>
            <Dropdown
              align="right"
              value={s.subtitleBackground}
              options={options<SubtitleBackground>(BG_KEYS)}
              onChange={(v) => updateSettings({ subtitleBackground: v })}
            />
          </Row>
          <Row title={t('sub.edge')}>
            <Dropdown align="right" value={s.subtitleEdge} options={options<SubtitleEdge>(EDGE_KEYS)} onChange={(v) => updateSettings({ subtitleEdge: v })} />
          </Row>
          <Row title={t('sub.position')}>
            <Dropdown
              align="right"
              value={s.subtitlePosition}
              options={options<SubtitlePosition>(POS_KEYS)}
              onChange={(v) => updateSettings({ subtitlePosition: v })}
            />
          </Row>
          <Row title={t('sub.font')}>
            <Dropdown align="right" value={s.subtitleFont} options={options<SubtitleFont>(FONT_KEYS)} onChange={(v) => updateSettings({ subtitleFont: v })} />
          </Row>
        </section>

        <section className="settings__section">
          <h2>{t('settings.account')}</h2>
          <div className="setting">
            <div className="setting__user">
              <button className="avatar-edit" onClick={() => setEditAvatar(true)} aria-label={t('profiles.editAvatar')} title={t('profiles.editAvatar')}>
                <Avatar userId={session.userId} tag={session.userImageTag} name={session.userName} size="lg" />
                <span className="avatar-edit__badge">
                  <Pencil />
                </span>
              </button>
              <div className="setting__text">
                <strong>{session.userName}</strong>
                <span>{session.isAdmin ? t('settings.admin') : t('settings.user')}</span>
              </div>
            </div>
            <div className="setting__control row">
              <button className="btn btn--ghost btn--sm" onClick={() => setEditAvatar(true)}>
                {t('profiles.editAvatar')}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await logout();
                  navigate('/profiles', { replace: true });
                }}
              >
                {t('nav.signOut')}
              </button>
            </div>
          </div>
          <div className="setting">
            <div className="setting__text">
              <strong>{info ? info.ServerName : session.serverName || t('settings.server')}</strong>
              <span>
                {session.serverUrl}
                {info ? ` · Jellyfin ${info.Version}` : ''}
              </span>
            </div>
          </div>
        </section>

        <section className="settings__section">
          <h2>{t('settings.profiles')}</h2>
          <Row title={t('profiles.alwaysLast')} desc={t('profiles.alwaysLastDesc')}>
            <Switch label={t('profiles.alwaysLast')} on={s.skipProfilePicker} onChange={(v) => updateSettings({ skipProfilePicker: v })} />
          </Row>
          <Row title={t('profiles.manage')}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                leaveProfile();
                navigate('/profiles', { replace: true });
              }}
            >
              {t('nav.switchProfile')}
            </button>
          </Row>
        </section>
        {editAvatar && (
          <AvatarPicker
            profile={session}
            onClose={() => setEditAvatar(false)}
            onUpdated={(tag) => updateProfile(session.id, { userImageTag: tag })}
          />
        )}

        <section className="settings__section">
          <h2>{t('settings.about')}</h2>
          <Row
            title={`JellyMax ${APP_VERSION}`}
            desc={
              t('settings.platform', { p: platformLabel, d: deviceId.slice(0, 10) }) +
              (window.__JM_SOURCE__ ? ' · ' + t(window.__JM_SOURCE__.from === 'server' ? 'settings.fromServer' : 'settings.fromLocal') : '')
            }
          >
            <span />
          </Row>
          <Row title={t('settings.formats')} desc={codecs}>
            <span />
          </Row>
        </section>
      </div>
    </div>
  );
}
