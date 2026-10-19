import { t } from '../i18n';
import { APP_NAME, APP_VERSION, deviceName } from '../platform';
import type {
  AuthResult,
  BaseItem,
  ItemsResult,
  MediaSegment,
  MediaSource,
  PlaybackInfoResponse,
  PublicSystemInfo,
  UserData,
  UserDto,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Corps brut (ex. image en base64) envoyé tel quel avec ce type MIME. */
  raw?: { data: string; type: string };
  timeoutMs?: number;
  retries?: number;
  keepalive?: boolean;
  base?: string;
}

const LIST_FIELDS = 'PrimaryImageAspectRatio,Overview,Genres,DateCreated,ChildCount';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadDeviceId(): string {
  const KEY = 'jm.deviceId';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  let id = 'jm';
  for (let i = 0; i < 4; i++) id += Math.random().toString(36).slice(2, 10);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export const deviceId = loadDeviceId();

export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  url = url.replace(/#.*$/, '').replace(/\/web(\/index\.html)?\/?$/i, '').replace(/\/+$/, '');
  return url;
}

/** Avatar proposé par le plugin serveur GetAvatar. */
export interface GalleryAvatar {
  id: string;
  name: string;
  category: string;
  url: string;
}

export class JellyfinApi {
  baseUrl = '';
  token = '';
  userId = '';
  onUnauthorized: (() => void) | null = null;

  configure(baseUrl: string, token = '', userId = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.userId = userId;
  }

  get authorization(): string {
    const parts = [
      `Client="${APP_NAME}"`,
      `Device="${deviceName}"`,
      `DeviceId="${deviceId}"`,
      `Version="${APP_VERSION}"`,
    ];
    if (this.token) parts.push(`Token="${this.token}"`);
    return 'MediaBrowser ' + parts.join(', ');
  }

  buildUrl(path: string, query?: Query, base = this.baseUrl): string {
    const qs = new URLSearchParams();
    if (query) {
      for (const key of Object.keys(query)) {
        const value = query[key];
        if (value === undefined || value === null || value === '') continue;
        qs.append(key, String(value));
      }
    }
    const s = qs.toString();
    return base + path + (s ? (path.indexOf('?') >= 0 ? '&' : '?') + s : '');
  }

  /** Requête HTTP avec délai d'expiration, nouvelles tentatives et gestion du 401. */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const retries = opts.retries ?? (method === 'GET' ? 2 : 0);
    const url = this.buildUrl(path, opts.query, opts.base ?? this.baseUrl);
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? 20000);
      try {
        const headers: Record<string, string> = { Accept: 'application/json', Authorization: this.authorization };
        let body: string | undefined;
        if (opts.raw) {
          headers['Content-Type'] = opts.raw.type;
          body = opts.raw.data;
        } else if (opts.body !== undefined) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(opts.body);
        }
        const res = await fetch(url, { method, headers, body, signal: ctrl?.signal, keepalive: opts.keepalive });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new ApiError(res.status, text || res.statusText || `HTTP ${res.status}`);
          if (res.status === 401 && this.token) this.onUnauthorized?.();
          if (res.status >= 500 && attempt < retries) {
            lastError = err;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw err;
        }
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        lastError = e;
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    const timedOut = lastError instanceof Error && lastError.name === 'AbortError';
    throw new ApiError(0, timedOut ? t('err.timeout') : t('err.unreachable'));
  }

  async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { Authorization: this.authorization } });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return res.text();
  }

  // ---------- Serveur & authentification ----------
  publicInfo(base: string) {
    return this.request<PublicSystemInfo>('/System/Info/Public', { base, timeoutMs: 8000, retries: 0 });
  }
  publicUsers() {
    return this.request<UserDto[]>('/Users/Public', { retries: 1 });
  }
  authenticate(username: string, password: string) {
    return this.request<AuthResult>('/Users/AuthenticateByName', {
      method: 'POST',
      body: { Username: username, Pw: password },
    });
  }
  quickConnectEnabled() {
    return this.request<boolean>('/QuickConnect/Enabled', { retries: 0, timeoutMs: 8000 });
  }
  quickConnectInitiate() {
    return this.request<{ Code: string; Secret: string; Authenticated: boolean }>('/QuickConnect/Initiate', {
      method: 'POST',
    });
  }
  quickConnectState(secret: string) {
    return this.request<{ Authenticated: boolean }>('/QuickConnect/Connect', { query: { secret }, retries: 0 });
  }
  authenticateQuickConnect(secret: string) {
    return this.request<AuthResult>('/Users/AuthenticateWithQuickConnect', { method: 'POST', body: { Secret: secret } });
  }
  logout() {
    return this.request<void>('/Sessions/Logout', { method: 'POST', timeoutMs: 5000 });
  }
  me() {
    return this.request<UserDto>('/Users/Me');
  }

  // ---------- Bibliothèque ----------
  views() {
    return this.request<ItemsResult>('/UserViews', { query: { userId: this.userId } });
  }
  items(query: Query) {
    return this.request<ItemsResult>('/Items', {
      query: { userId: this.userId, fields: LIST_FIELDS, enableTotalRecordCount: true, ...query },
    });
  }
  item(id: string) {
    return this.request<BaseItem>(`/Items/${id}`, { query: { userId: this.userId } });
  }
  resume(limit = 24, includeItemTypes?: string) {
    return this.request<ItemsResult>('/UserItems/Resume', {
      query: {
        userId: this.userId,
        limit,
        mediaTypes: 'Video',
        includeItemTypes,
        fields: LIST_FIELDS,
        enableTotalRecordCount: false,
      },
    });
  }
  persons(searchTerm: string, limit = 20) {
    return this.request<ItemsResult>('/Persons', { query: { userId: this.userId, searchTerm, limit } });
  }
  latest(parentId: string, limit = 24) {
    return this.request<BaseItem[]>('/Items/Latest', {
      query: { userId: this.userId, parentId, limit, fields: LIST_FIELDS, groupItems: true },
    });
  }
  nextUp(q: { seriesId?: string; limit?: number; enableResumable?: boolean }) {
    return this.request<ItemsResult>('/Shows/NextUp', {
      query: {
        userId: this.userId,
        fields: LIST_FIELDS,
        enableTotalRecordCount: false,
        disableFirstEpisode: false,
        enableRewatching: false,
        ...q,
      },
    });
  }
  seasons(seriesId: string) {
    return this.request<ItemsResult>(`/Shows/${seriesId}/Seasons`, {
      query: { userId: this.userId, fields: 'PrimaryImageAspectRatio,ChildCount' },
    });
  }
  episodes(seriesId: string, q: { seasonId?: string; startItemId?: string; limit?: number } = {}) {
    return this.request<ItemsResult>(`/Shows/${seriesId}/Episodes`, {
      query: { userId: this.userId, fields: 'Overview,PrimaryImageAspectRatio', ...q },
    });
  }
  similar(id: string, limit = 18) {
    return this.request<ItemsResult>(`/Items/${id}/Similar`, { query: { userId: this.userId, limit, fields: LIST_FIELDS } });
  }
  genres(q: { parentId?: string; includeItemTypes?: string; searchTerm?: string; limit?: number }) {
    return this.request<ItemsResult>('/Genres', {
      query: { userId: this.userId, sortBy: 'SortName', sortOrder: 'Ascending', ...q },
    });
  }
  setFavorite(id: string, favorite: boolean) {
    return this.request<UserData>(`/UserFavoriteItems/${id}`, {
      method: favorite ? 'POST' : 'DELETE',
      query: { userId: this.userId },
    });
  }
  setPlayed(id: string, played: boolean) {
    return this.request<UserData>(`/UserPlayedItems/${id}`, {
      method: played ? 'POST' : 'DELETE',
      query: { userId: this.userId },
    });
  }
  async segments(id: string): Promise<MediaSegment[]> {
    try {
      const r = await this.request<{ Items: MediaSegment[] }>(`/MediaSegments/${id}`, { retries: 0, timeoutMs: 8000 });
      return (r && r.Items) || [];
    } catch {
      return [];
    }
  }

  // ---------- Lecture ----------
  playbackInfo(id: string, body: Record<string, unknown>) {
    return this.request<PlaybackInfoResponse>(`/Items/${id}/PlaybackInfo`, {
      method: 'POST',
      query: { userId: this.userId },
      body,
      retries: 1,
      timeoutMs: 30000,
    });
  }
  reportStart(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing', { method: 'POST', body, timeoutMs: 10000 });
  }
  reportProgress(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing/Progress', { method: 'POST', body, timeoutMs: 8000 });
  }
  reportStopped(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing/Stopped', { method: 'POST', body, keepalive: true, timeoutMs: 8000 });
  }
  stopEncoding(playSessionId: string) {
    return this.request<void>('/Videos/ActiveEncodings', {
      method: 'DELETE',
      query: { deviceId, playSessionId },
      keepalive: true,
      timeoutMs: 8000,
    });
  }

  // ---------- Avatar ----------
  /**
   * Galerie d'avatars du serveur (plugin GetAvatar). Renvoie null si le plugin n'est pas installé.
   * Les avatars proposés dépendent donc de chaque serveur.
   */
  async avatarGallery(): Promise<GalleryAvatar[] | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = await this.request<any[]>('/GetAvatar/Avatars', { retries: 0, timeoutMs: 10000 });
      if (!Array.isArray(list)) return null;
      return list
        .map((a) => {
          const id = String(a.Id ?? a.id ?? '');
          const url = String(a.Url ?? a.url ?? `/GetAvatar/Image/${id}`);
          return {
            id,
            name: String(a.Name ?? a.name ?? ''),
            category: String(a.Category ?? a.category ?? ''),
            url: /^https?:/i.test(url) ? url : this.baseUrl + url,
          };
        })
        .filter((a) => a.id);
    } catch {
      return null;
    }
  }
  /** Applique un avatar de la galerie : le plugin l'enregistre comme image de profil Jellyfin. */
  setGalleryAvatar(avatarId: string) {
    return this.request<void>('/GetAvatar/SetAvatar', { method: 'POST', body: { AvatarId: avatarId, UserId: this.userId } });
  }
  /** Envoie une image (base64) comme photo de profil Jellyfin. */
  async uploadUserImage(base64: string, mime: string) {
    try {
      await this.request<void>('/UserImage', { method: 'POST', query: { userId: this.userId }, raw: { data: base64, type: mime } });
    } catch (e) {
      // Serveurs plus anciens : ancienne route.
      if (e instanceof ApiError && e.status === 404) {
        await this.request<void>(`/Users/${this.userId}/Images/Primary`, { method: 'POST', raw: { data: base64, type: mime } });
      } else throw e;
    }
  }
  async deleteUserImage() {
    try {
      await this.request<void>('/UserImage', { method: 'DELETE', query: { userId: this.userId } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await this.request<void>(`/Users/${this.userId}/Images/Primary`, { method: 'DELETE' });
      } else throw e;
    }
  }

  // ---------- URLs ----------
  imageUrl(
    itemId: string,
    type: string,
    opts: { tag?: string; maxWidth?: number; maxHeight?: number; quality?: number; index?: number } = {},
  ) {
    const path = `/Items/${itemId}/Images/${type}${opts.index != null ? `/${opts.index}` : ''}`;
    return this.buildUrl(path, {
      tag: opts.tag,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      quality: opts.quality ?? 90,
    });
  }
  userImageUrl(userId: string, tag: string, base = this.baseUrl) {
    return this.buildUrl(`/Users/${userId}/Images/Primary`, { tag, maxWidth: 300, quality: 90 }, base);
  }
  directPlayUrl(itemId: string, source: MediaSource) {
    return this.buildUrl(`/Videos/${itemId}/stream`, {
      static: true,
      mediaSourceId: source.Id,
      deviceId,
      api_key: this.token,
      Tag: source.ETag,
      LiveStreamId: source.LiveStreamId,
    });
  }
  /** Rend absolue une URL relative renvoyée par le serveur et y ajoute le jeton si besoin. */
  absolute(url: string) {
    const full = /^https?:\/\//i.test(url) ? url : this.baseUrl + (url.charAt(0) === '/' ? '' : '/') + url;
    if (/[?&](api_key|ApiKey)=/i.test(full)) return full;
    return full + (full.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(this.token);
  }
  trickplayUrl(itemId: string, width: number, index: number, mediaSourceId: string) {
    return this.buildUrl(`/Videos/${itemId}/Trickplay/${width}/${index}.jpg`, { mediaSourceId, api_key: this.token });
  }
}

export const api = new JellyfinApi();
