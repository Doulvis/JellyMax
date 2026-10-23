// Téléchargements hors connexion (Windows et Android) : file d'attente, progression et fichiers.
// Le fichier d'origine est téléchargé tel quel depuis le serveur (même qualité que la lecture directe).
// Windows : gestionnaire de téléchargements d'Electron, dossier Vidéos\JellyMax.
// Android : gestionnaire de téléchargements du système, qui continue en arrière-plan.

import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { landscapeUrl } from '../api/images';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { isAndroid, isElectron, native, type NativeDownloadProgress } from '../platform';
import { episodeCode } from '../utils/format';
import { deleteImage, saveImage } from './images';

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error';

export interface DownloadEntry {
  key: string;
  itemId: string;
  serverId: string;
  serverUrl: string;
  /** Copie de la fiche du titre, pour l'afficher et le lire hors connexion. */
  item: BaseItem;
  status: DownloadStatus;
  received: number;
  total: number;
  file?: string;
  nativeId?: string;
  error?: string;
  addedAt: number;
  /** Position de lecture hors connexion, en secondes. */
  position?: number;
}

const KEY = 'jm.downloads';
/** Windows : téléchargements simultanés (Android gère sa propre file d'attente). */
const MAX_ACTIVE = 2;

const electronApi = () => (isElectron && window.jellymax ? window.jellymax.downloads : undefined);
const androidApi = () => (isAndroid ? native.downloads : undefined);

/** Téléchargements disponibles sur cette plateforme (pas sur TV ni dans un navigateur). */
export const downloadsSupported = isAndroid || (isElectron && !!(window.jellymax && window.jellymax.downloads));

function load(): DownloadEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DownloadEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: DownloadEntry[] = load();
const listeners = new Set<() => void>();

function commit(next: DownloadEntry[]) {
  entries = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function patch(key: string, changes: Partial<DownloadEntry>) {
  if (!entries.some((e) => e.key === key)) return;
  commit(entries.map((e) => (e.key === key ? { ...e, ...changes } : e)));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getAll = () => entries;

export function useDownloads(): DownloadEntry[] {
  return useSyncExternalStore(subscribe, getAll);
}

export const downloadKey = (serverId: string, itemId: string) => `${serverId}:${itemId}`;

export function findDownload(itemId: string): DownloadEntry | undefined {
  return entries.find((e) => e.itemId === itemId && (!api.baseUrl || e.serverUrl === api.baseUrl));
}

export function useDownload(itemId: string): DownloadEntry | undefined {
  const list = useDownloads();
  return list.find((e) => e.itemId === itemId && (!api.baseUrl || e.serverUrl === api.baseUrl));
}

/** Nom du fichier enregistré : « Film (2010).mkv » ou « Série - S01E02 - Titre.mkv ». */
function fileNameFor(item: BaseItem): string {
  const src = item.MediaSources && item.MediaSources[0];
  let ext = '';
  const path = src && src.Path;
  const m = path ? /\.([a-z0-9]{2,5})$/i.exec(path) : null;
  if (m) ext = m[1];
  else if (src && src.Container) ext = src.Container.split(',')[0];
  const name =
    item.Type === 'Episode'
      ? [item.SeriesName, episodeCode(item), item.Name].filter(Boolean).join(' - ')
      : item.ProductionYear
        ? `${item.Name} (${item.ProductionYear})`
        : item.Name;
  return ext ? `${name}.${ext.toLowerCase()}` : name;
}

function sourceUrl(e: DownloadEntry) {
  // `ApiKey` (Jellyfin 10.8+) : `api_key` est refusé depuis Jellyfin 12.
  return api.buildUrl(`/Items/${e.itemId}/Download`, { ApiKey: api.token }, e.serverUrl);
}

/** Vérifie que le compte a le droit de télécharger avant de lancer le transfert (message clair sinon). */
async function checkAllowed(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal });
    ctrl.abort();
    if (res.status === 401 || res.status === 403) throw new Error(t('dl.err.forbidden'));
    if (!res.ok) throw new Error(t('dl.err.http', { code: res.status }));
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return;
    throw e instanceof Error && e.message ? e : new Error(t('err.unreachable'));
  } finally {
    clearTimeout(timer);
  }
}

let pumping = false;

/** Démarre les téléchargements en attente (une fois connecté : l'adresse contient le jeton d'accès). */
export async function pump() {
  if (pumping || !api.token) return;
  pumping = true;
  try {
    for (;;) {
      const active = entries.filter((e) => e.status === 'downloading').length;
      if (isElectron && active >= MAX_ACTIVE) break;
      const next = entries.filter((e) => e.status === 'queued').sort((a, b) => a.addedAt - b.addedAt)[0];
      if (!next) break;
      patch(next.key, { status: 'downloading', received: 0, error: undefined });
      try {
        const url = sourceUrl(next);
        await checkAllowed(url);
        const title = next.item.Type === 'Episode' ? `${next.item.SeriesName} · ${episodeCode(next.item)}` : next.item.Name;
        const el = electronApi();
        const an = androidApi();
        if (el) {
          const r = await el.start({ key: next.key, url, fileName: fileNameFor(next.item) });
          patch(next.key, { file: r.file });
        } else if (an) {
          const r = await an.start(url, fileNameFor(next.item), title);
          patch(next.key, { file: r.file, nativeId: r.id });
          schedulePoll();
        } else {
          throw new Error(t('dl.err.unsupported'));
        }
      } catch (e) {
        patch(next.key, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    pumping = false;
  }
}

function onElectronProgress(p: NativeDownloadProgress) {
  const e = entries.find((x) => x.key === p.key);
  if (!e) return;
  if (p.state === 'progressing') patch(p.key, { received: p.received, total: p.total || e.total, file: p.file });
  else if (p.state === 'completed') patch(p.key, { status: 'done', received: p.received, total: p.received, file: p.file });
  else if (p.state === 'failed') {
    patch(p.key, { status: 'error', error: t('dl.err.interrupted') });
    removeFile(e);
  }
  if (p.state !== 'progressing') pump();
}

// Android : le système ne prévient pas l'application, on interroge l'état tant qu'un téléchargement est actif.
let pollTimer = 0;
function schedulePoll() {
  if (pollTimer || !androidApi()) return;
  pollTimer = window.setTimeout(poll, 1500);
}

async function poll() {
  pollTimer = 0;
  const an = androidApi();
  const active = entries.filter((e) => e.status === 'downloading' && e.nativeId);
  if (!an || !active.length) return;
  try {
    const states = await an.status(active.map((e) => e.nativeId!));
    for (const e of active) {
      const s = states.find((x) => x.id === e.nativeId);
      if (!s) patch(e.key, { status: 'error', error: t('dl.err.interrupted') });
      else if (s.state === 'completed') patch(e.key, { status: 'done', received: s.received, total: s.received });
      else if (s.state === 'failed') {
        patch(e.key, { status: 'error', error: t('dl.err.interrupted') });
        an.remove(e.nativeId, e.file).catch(() => {});
      } else patch(e.key, { received: s.received, total: s.total > 0 ? s.total : e.total });
    }
  } catch {
    /* nouvel essai au prochain passage */
  }
  if (entries.some((e) => e.status === 'downloading')) schedulePoll();
}

function removeFile(e: DownloadEntry) {
  const el = electronApi();
  const an = androidApi();
  if (el && e.file) el.remove(e.file).catch(() => {});
  if (an) an.remove(e.nativeId, e.file).catch(() => {});
}

/** Ajoute des titres (films ou épisodes complets, avec MediaSources) à la file de téléchargement. */
export function enqueueDownloads(items: BaseItem[]) {
  const serverUrl = api.baseUrl;
  const add: DownloadEntry[] = [];
  const now = Date.now();
  items.forEach((item, i) => {
    const key = downloadKey(item.ServerId || serverUrl, item.Id);
    if (entries.some((e) => e.key === key) || add.some((e) => e.key === key)) return;
    const src = item.MediaSources && item.MediaSources[0];
    add.push({
      key,
      itemId: item.Id,
      serverId: item.ServerId || serverUrl,
      serverUrl,
      item: { ...item, People: undefined, Trickplay: undefined },
      status: 'queued',
      received: 0,
      total: (src && src.Size) || 0,
      addedAt: now + i,
    });
    const img = landscapeUrl(item, 480);
    if (img) saveImage(key, img);
  });
  if (!add.length) return;
  commit([...entries, ...add]);
  pump();
}

export function cancelDownload(key: string) {
  const e = entries.find((x) => x.key === key);
  if (!e) return;
  const el = electronApi();
  if (el && e.status === 'downloading') el.cancel(key).catch(() => {});
  removeFile(e);
  deleteImage(key);
  commit(entries.filter((x) => x.key !== key));
  pump();
}

export const deleteDownload = cancelDownload;

export function retryDownload(key: string) {
  patch(key, { status: 'queued', received: 0, error: undefined, file: undefined, nativeId: undefined });
  pump();
}

export function setOfflinePosition(itemId: string, seconds: number) {
  const e = findDownload(itemId);
  if (e && e.status === 'done') patch(e.key, { position: seconds });
}

/** Adresse lisible par le lecteur vidéo pour un fichier téléchargé. */
export async function localUrl(e: DownloadEntry): Promise<string> {
  if (!e.file) throw new Error(t('dl.err.missing'));
  const el = electronApi();
  const an = androidApi();
  const url = el ? await el.fileUrl(e.file) : an ? await an.fileUrl(e.file) : '';
  if (!url) throw new Error(t('dl.err.missing'));
  return url;
}

export function openDownloadFolder() {
  const el = electronApi();
  if (el) el.openFolder().catch(() => {});
}

/** Au démarrage : reprise du suivi, nettoyage des fichiers supprimés à la main. */
export function initDownloads() {
  const el = electronApi();
  const an = androidApi();
  if (!el && !an) return;
  if (el) {
    el.onProgress(onElectronProgress);
    // Windows : un téléchargement interrompu par la fermeture de l'application est à relancer.
    entries
      .filter((e) => e.status === 'downloading')
      .forEach((e) => {
        removeFile(e);
        patch(e.key, { status: 'error', error: t('dl.err.interrupted') });
      });
  }
  const exists = (file: string) => (el ? el.exists(file) : an!.exists(file));
  entries
    .filter((e) => e.status === 'done')
    .forEach((e) => {
      if (!e.file) return;
      exists(e.file)
        .then((ok) => {
          if (!ok) {
            deleteImage(e.key);
            commit(entries.filter((x) => x.key !== e.key));
          }
        })
        .catch(() => {});
    });
  schedulePoll();
  pump();
}
