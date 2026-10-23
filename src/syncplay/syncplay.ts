// Regarder ensemble : client SyncPlay de Jellyfin (compatible avec l'application Jellyfin officielle).
// Le serveur coordonne le groupe ; chaque participant lui envoie ses demandes (lecture, pause, déplacement)
// et applique les commandes reçues par WebSocket à l'heure du serveur indiquée, pour rester synchronisé.

import { useSyncExternalStore } from 'react';
import { api, deviceId } from '../api/client';
import { t } from '../i18n';
import { TPS } from '../utils/format';

export interface GroupInfo {
  GroupId: string;
  GroupName: string;
  State?: string;
  Participants: string[];
  LastUpdatedAt?: string;
}

/** Ce que le lecteur expose au groupe. */
export interface PlayerAdapter {
  itemId: string;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  currentTime(): number;
  isPaused(): boolean;
  /** Assez de données chargées pour lire immédiatement. */
  isReady(): boolean;
  stop(): void;
}

interface Toast {
  id: number;
  text: string;
}

export interface SyncPlayState {
  group: GroupInfo | null;
  groupState: string;
  panel: { open: boolean; itemId?: string; name?: string };
  toasts: Toast[];
}

interface Command {
  GroupId: string;
  PlaylistItemId: string;
  When: string;
  PositionTicks: number;
  Command: 'Unpause' | 'Pause' | 'Stop' | 'Seek';
}

interface PlayQueue {
  Reason: string;
  Playlist: { ItemId: string; PlaylistItemId: string }[];
  PlayingItemIndex: number;
  StartPositionTicks: number;
  IsPlaying: boolean;
}

// ---------------------------------------------------------------------------
// État observable
// ---------------------------------------------------------------------------

let state: SyncPlayState = { group: null, groupState: 'Idle', panel: { open: false }, toasts: [] };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncPlayState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSyncPlay(): SyncPlayState {
  return useSyncExternalStore(subscribe, () => state);
}

export function inGroup() {
  return !!state.group;
}

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  setState({ toasts: [...state.toasts, { id, text }].slice(-3) });
  window.setTimeout(() => setState({ toasts: state.toasts.filter((x) => x.id !== id) }), 4500);
}

export function openWatchTogether(target?: { itemId: string; name: string }) {
  setState({ panel: { open: true, itemId: target && target.itemId, name: target && target.name } });
}

export function closeWatchTogether() {
  setState({ panel: { open: false } });
}

let navigateFn: ((to: string, replace: boolean) => void) | null = null;
export function setSyncPlayNavigator(fn: ((to: string, replace: boolean) => void) | null) {
  navigateFn = fn;
}

// ---------------------------------------------------------------------------
// Heure du serveur
// ---------------------------------------------------------------------------

let offset = 0; // heure serveur - heure locale (ms)

const parseDate = (s: string) => Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
const serverNow = () => Date.now() + offset;
const toLocal = (when: string) => parseDate(when) - offset;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function syncTime() {
  let best: { offset: number; delay: number } | null = null;
  for (let i = 0; i < 5; i++) {
    try {
      const t0 = Date.now();
      const r = await api.request<{ RequestReceptionTime: string; ResponseTransmissionTime: string }>('/GetUtcTime', {
        retries: 0,
        timeoutMs: 5000,
      });
      const t3 = Date.now();
      const recv = parseDate(r.RequestReceptionTime);
      const sent = parseDate(r.ResponseTransmissionTime);
      const sample = { offset: (recv - t0 + (sent - t3)) / 2, delay: t3 - t0 - (sent - recv) };
      if (!best || sample.delay < best.delay) best = sample;
    } catch {
      /* échantillon perdu */
    }
    await sleep(120);
  }
  if (best) {
    offset = best.offset;
    post('Ping', { Ping: Math.max(0, Math.round(best.delay)) }).catch(() => {});
  }
}

let timeSyncTimer = 0;
function startTimeSyncLoop() {
  window.clearInterval(timeSyncTimer);
  timeSyncTimer = window.setInterval(() => {
    if (state.group) syncTime();
  }, 60000);
}

// ---------------------------------------------------------------------------
// WebSocket du serveur
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let wsKey = '';
let wsReady: Promise<void> | null = null;
let keepAlive = 0;
let reconnectTimer = 0;

function ensureSocket(): Promise<void> {
  const key = `${api.baseUrl}|${api.token}`;
  if (ws && wsKey === key && wsReady && ws.readyState <= 1) return wsReady;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  wsKey = key;
  // `ApiKey` pour les serveurs récents (qui refusent `api_key` ici), `api_key` pour les plus anciens.
  const token = encodeURIComponent(api.token);
  const url = api.baseUrl.replace(/^http/i, 'ws') + `/socket?ApiKey=${token}&api_key=${token}&deviceId=${encodeURIComponent(deviceId)}`;
  const socket = new WebSocket(url);
  ws = socket;
  wsReady = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(t('err.unreachable'))), 10000);
    socket.onopen = () => {
      window.clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(t('err.unreachable')));
    };
  });
  wsReady.catch(() => {});
  socket.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(String(ev.data)));
    } catch {
      /* message illisible */
    }
  };
  socket.onclose = () => {
    window.clearInterval(keepAlive);
    if (ws !== socket) return;
    ws = null;
    wsReady = null;
    // Toujours dans un groupe : on se reconnecte pour continuer à recevoir les commandes.
    if (state.group) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => ensureSocket().catch(() => {}), 3000);
    }
  };
  return wsReady;
}

function send(msg: unknown) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function onMessage(msg: { MessageType: string; Data?: unknown }) {
  switch (msg.MessageType) {
    case 'ForceKeepAlive': {
      window.clearInterval(keepAlive);
      const sec = Number(msg.Data) || 60;
      keepAlive = window.setInterval(() => send({ MessageType: 'KeepAlive' }), (sec * 1000) / 2);
      send({ MessageType: 'KeepAlive' });
      break;
    }
    case 'SyncPlayGroupUpdate':
      onGroupUpdate(msg.Data as { Type: string; Data: unknown });
      break;
    case 'SyncPlayCommand':
      onCommand(msg.Data as Command);
      break;
  }
}

// ---------------------------------------------------------------------------
// Groupe
// ---------------------------------------------------------------------------

function post(path: string, body: Record<string, unknown> = {}) {
  return api.request<unknown>(`/SyncPlay/${path}`, { method: 'POST', body, retries: 0 });
}

/** Message clair si le compte n'a pas accès à SyncPlay. */
export function syncPlayError(e: unknown): string {
  const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0;
  if (status === 403) return t('sp.err.forbidden');
  return e instanceof Error && e.message ? e.message : t('err.unreachable');
}

export async function listGroups(): Promise<GroupInfo[]> {
  const r = await api.request<GroupInfo[]>('/SyncPlay/List', { retries: 0 });
  return r || [];
}

let pendingItem: string | null = null;

export async function createGroup(name: string, itemId?: string) {
  await ensureSocket();
  await syncTime();
  pendingItem = itemId || null;
  await post('New', { GroupName: name });
}

export async function joinGroup(groupId: string) {
  await ensureSocket();
  await syncTime();
  await post('Join', { GroupId: groupId });
}

export async function leaveGroup() {
  try {
    await post('Leave');
  } finally {
    resetGroup();
  }
}

/** Lance un titre pour tout le groupe. */
export function playInGroup(itemId: string, startSec = 0) {
  return post('SetNewQueue', { PlayingQueue: [itemId], PlayingItemPosition: 0, StartPositionTicks: Math.round(startSec * TPS) });
}

function resetGroup() {
  setState({ group: null, groupState: 'Idle' });
  queue = null;
  pendingItem = null;
  stopDriftCheck();
  window.clearTimeout(commandTimer);
  window.clearInterval(timeSyncTimer);
}

let queue: { itemId: string; playlistItemId: string } | null = null;

function onGroupUpdate(u: { Type: string; Data: unknown }) {
  switch (u.Type) {
    case 'GroupJoined': {
      const g = u.Data as GroupInfo;
      setState({ group: { ...g, Participants: g.Participants || [] }, groupState: g.State || 'Idle' });
      toast(t('sp.joined', { name: g.GroupName }));
      startTimeSyncLoop();
      if (pendingItem) {
        const id = pendingItem;
        pendingItem = null;
        playInGroup(id).catch(() => {});
      }
      break;
    }
    case 'UserJoined':
      if (state.group) {
        const name = String(u.Data);
        setState({ group: { ...state.group, Participants: [...state.group.Participants, name] } });
        toast(t('sp.userJoined', { name }));
      }
      break;
    case 'UserLeft':
      if (state.group) {
        const name = String(u.Data);
        const list = state.group.Participants.slice();
        const i = list.indexOf(name);
        if (i >= 0) list.splice(i, 1);
        setState({ group: { ...state.group, Participants: list } });
        toast(t('sp.userLeft', { name }));
      }
      break;
    case 'GroupLeft':
    case 'NotInGroup':
      if (state.group) toast(t('sp.left'));
      resetGroup();
      break;
    case 'GroupDoesNotExist':
      toast(t('sp.err.noGroup'));
      resetGroup();
      break;
    case 'LibraryAccessDenied':
      toast(t('sp.err.library'));
      break;
    case 'StateUpdate':
      setState({ groupState: (u.Data as { State: string }).State });
      break;
    case 'PlayQueue':
      onPlayQueue(u.Data as PlayQueue);
      break;
  }
}

function onPlayQueue(q: PlayQueue) {
  const cur = q.Playlist && q.Playlist[q.PlayingItemIndex];
  if (!cur) {
    queue = null;
    return;
  }
  queue = { itemId: cur.ItemId, playlistItemId: cur.PlaylistItemId };
  const startSec = (q.StartPositionTicks || 0) / TPS;
  if (player && player.itemId === cur.ItemId) {
    player.pause();
    if (Math.abs(player.currentTime() - startSec) > 1) player.seek(startSec);
    reportReadySoon();
  } else if (navigateFn) {
    const onPlayer = /^#\/play\//.test(window.location.hash);
    navigateFn(`/play/${cur.ItemId}?t=${startSec.toFixed(2)}`, onPlayer);
  }
}

// ---------------------------------------------------------------------------
// Lecteur
// ---------------------------------------------------------------------------

let player: PlayerAdapter | null = null;
let commandTimer = 0;
let driftTimer = 0;
let readyTimer = 0;

function body(isPlaying?: boolean) {
  return {
    When: new Date(serverNow()).toISOString(),
    PositionTicks: Math.round((player ? player.currentTime() : 0) * TPS),
    IsPlaying: isPlaying != null ? isPlaying : !!player && !player.isPaused(),
    PlaylistItemId: queue ? queue.playlistItemId : '',
  };
}

/** Prévient le groupe dès que le lecteur peut lire (le serveur relance alors la lecture pour tous). */
function reportReadySoon() {
  window.clearInterval(readyTimer);
  const started = Date.now();
  readyTimer = window.setInterval(() => {
    if (!player || !queue || player.itemId !== queue.itemId || Date.now() - started > 60000) {
      window.clearInterval(readyTimer);
      return;
    }
    // Après 10 s on se déclare prêt quand même, pour ne pas bloquer tout le groupe.
    if (player.isReady() || Date.now() - started > 10000) {
      window.clearInterval(readyTimer);
      post('Ready', body(false)).catch(() => {});
    }
  }, 250);
}

/** Le lecteur s'attache au groupe. Renvoie true si la lecture est pilotée par le groupe. */
export function attachPlayer(p: PlayerAdapter, startSec = 0): boolean {
  player = p;
  buffering = false;
  if (!state.group) return false;
  if (!queue || queue.itemId !== p.itemId) {
    // Titre lancé localement pendant qu'on est dans un groupe : il devient le titre du groupe.
    playInGroup(p.itemId, startSec).catch(() => {});
  } else {
    post('Buffering', body(false)).catch(() => {});
    reportReadySoon();
  }
  return true;
}

export function detachPlayer(p: PlayerAdapter) {
  if (player !== p) return;
  player = null;
  stopDriftCheck();
  window.clearTimeout(commandTimer);
  window.clearInterval(readyTimer);
}

/** Demandes de l'utilisateur pendant une séance de groupe (le serveur répond par une commande). */
export function requestPlayPause(paused: boolean) {
  post(paused ? 'Unpause' : 'Pause').catch(() => {});
}

export function requestSeek(sec: number) {
  post('Seek', { PositionTicks: Math.round(Math.max(0, sec) * TPS) }).catch(() => {});
}

export function requestNext(itemId: string) {
  playInGroup(itemId).catch(() => {});
}

let buffering = false;
/** Le lecteur attend des données (ou repart) pendant la lecture de groupe. */
export function reportBuffering(isBuffering: boolean) {
  if (!state.group || !player || !queue || player.itemId !== queue.itemId) return;
  if (isBuffering === buffering) return;
  buffering = isBuffering;
  if (isBuffering) post('Buffering', body(true)).catch(() => {});
  else post('Ready', body(true)).catch(() => {});
}

function onCommand(c: Command) {
  if (!player || !queue || player.itemId !== queue.itemId) return;
  if (c.PlaylistItemId && c.PlaylistItemId !== queue.playlistItemId) return;
  window.clearTimeout(commandTimer);
  const p = player;
  const whenLocal = toLocal(c.When);
  const pos = (c.PositionTicks || 0) / TPS;
  const delay = Math.max(0, whenLocal - Date.now());
  switch (c.Command) {
    case 'Unpause':
      commandTimer = window.setTimeout(() => {
        const expected = pos + Math.max(0, Date.now() - whenLocal) / 1000;
        if (Math.abs(p.currentTime() - expected) > 0.4) p.seek(expected);
        p.play();
        startDriftCheck(pos, whenLocal);
      }, delay);
      break;
    case 'Pause':
      stopDriftCheck();
      commandTimer = window.setTimeout(() => {
        p.pause();
        if (Math.abs(p.currentTime() - pos) > 0.3) p.seek(pos);
      }, delay);
      break;
    case 'Seek':
      stopDriftCheck();
      p.pause();
      p.seek(pos);
      reportReadySoon();
      break;
    case 'Stop':
      stopDriftCheck();
      p.stop();
      break;
  }
}

/** Pendant la lecture, recale le lecteur s'il s'écarte de plus d'une seconde de la position du groupe. */
function startDriftCheck(pos: number, whenLocal: number) {
  stopDriftCheck();
  driftTimer = window.setInterval(() => {
    const p = player;
    if (!p || p.isPaused() || buffering || !p.isReady()) return;
    const expected = pos + (Date.now() - whenLocal) / 1000;
    if (Math.abs(p.currentTime() - expected) > 1) p.seek(expected);
  }, 2000);
}

function stopDriftCheck() {
  window.clearInterval(driftTimer);
}
