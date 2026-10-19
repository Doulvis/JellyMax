import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, JellyfinApi } from '../api/client';
import type { AuthResult } from '../api/types';
import { getSettings } from './settings';

/** Serveur en cours d'ajout (écrans de connexion). */
export interface ServerInfo {
  url: string;
  id: string;
  name: string;
  version: string;
}

/** Un profil = un compte Jellyfin enregistré sur cet appareil (éventuellement sur des serveurs différents). */
export interface Profile {
  id: string;
  serverUrl: string;
  serverId: string;
  serverName: string;
  userId: string;
  userName: string;
  /** Vide si le jeton a été révoqué : une reconnexion est alors nécessaire. */
  accessToken: string;
  userImageTag?: string;
  isAdmin?: boolean;
  lastUsed: number;
}

const SERVER_KEY = 'jm.server';
const PROFILES_KEY = 'jm.profiles';
const ACTIVE_KEY = 'jm.activeProfile';
const LEGACY_SESSION_KEY = 'jm.session';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function loadProfiles(): Profile[] {
  const list = read<Profile[]>(PROFILES_KEY) || [];
  // Ancienne version : une seule session enregistrée → converti en profil.
  const legacy = read<Omit<Profile, 'id' | 'lastUsed'>>(LEGACY_SESSION_KEY);
  if (legacy && legacy.accessToken) {
    const id = `${legacy.serverId}:${legacy.userId}`;
    if (!list.some((p) => p.id === id)) list.push({ ...legacy, id, lastUsed: Date.now() });
    write(PROFILES_KEY, list);
    write(ACTIVE_KEY, id);
  }
  write(LEGACY_SESSION_KEY, null);
  return list;
}

export function profileImageUrl(p: Pick<Profile, 'serverUrl' | 'userId' | 'userImageTag'>) {
  return p.userImageTag ? api.userImageUrl(p.userId, p.userImageTag, p.serverUrl) : undefined;
}

interface AuthContextValue {
  server: ServerInfo | null;
  session: Profile | null;
  profiles: Profile[];
  setServer(info: ServerInfo | null): void;
  completeLogin(result: AuthResult): void;
  /** Active un profil. Renvoie false s'il faut d'abord se reconnecter. */
  selectProfile(id: string): boolean;
  /** Revient à l'écran des profils sans déconnecter le compte. */
  leaveProfile(): void;
  /** Déconnecte le profil actif et le retire de l'appareil. */
  logout(): Promise<void>;
  removeProfile(id: string): Promise<void>;
  updateProfile(id: string, patch: Partial<Profile>): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  const [server, setServerState] = useState<ServerInfo | null>(() => read<ServerInfo>(SERVER_KEY));
  const [session, setSession] = useState<Profile | null>(() => {
    const list = read<Profile[]>(PROFILES_KEY) || [];
    if (getSettings().skipProfilePicker) {
      const activeId = read<string>(ACTIVE_KEY);
      const p = list.find((x) => x.id === activeId && x.accessToken);
      if (p) {
        api.configure(p.serverUrl, p.accessToken, p.userId);
        return p;
      }
    }
    const sv = read<ServerInfo>(SERVER_KEY);
    if (sv) api.configure(sv.url);
    return null;
  });

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const persist = useCallback((list: Profile[]) => {
    write(PROFILES_KEY, list);
    profilesRef.current = list;
    setProfiles(list);
  }, []);

  const updateProfile = useCallback(
    (id: string, patch: Partial<Profile>) => {
      persist(profilesRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      setSession((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
    },
    [persist],
  );

  /** Rafraîchit nom, avatar et droits du profil actif (et valide son jeton). */
  const refreshActive = useCallback(
    (p: Profile) => {
      api
        .me()
        .then((u) => {
          if (u) updateProfile(p.id, { userName: u.Name, userImageTag: u.PrimaryImageTag, isAdmin: u.Policy?.IsAdministrator });
        })
        .catch(() => {});
    },
    [updateProfile],
  );

  const activate = useCallback(
    (p: Profile) => {
      const next = { ...p, lastUsed: Date.now() };
      api.configure(next.serverUrl, next.accessToken, next.userId);
      persist(profilesRef.current.filter((x) => x.id !== p.id).concat(next));
      write(ACTIVE_KEY, next.id);
      setSession(next);
      refreshActive(next);
    },
    [persist, refreshActive],
  );

  // Jeton révoqué côté serveur : le profil reste mais demandera une reconnexion.
  useEffect(() => {
    api.onUnauthorized = () => {
      const cur = sessionRef.current;
      if (cur) updateProfile(cur.id, { accessToken: '' });
      api.configure(api.baseUrl);
      setSession(null);
    };
    return () => {
      api.onUnauthorized = null;
    };
  }, [updateProfile]);

  // Profil ouvert automatiquement au démarrage : on valide son jeton.
  useEffect(() => {
    if (session) refreshActive(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setServer = useCallback((info: ServerInfo | null) => {
    write(SERVER_KEY, info);
    setServerState(info);
    api.configure(info ? info.url : '');
  }, []);

  const completeLogin = useCallback(
    (r: AuthResult) => {
      const id = `${r.ServerId}:${r.User.Id}`;
      const existing = profilesRef.current.find((p) => p.id === id);
      activate({
        id,
        serverUrl: api.baseUrl,
        serverId: r.ServerId,
        serverName: (server && server.name) || (existing && existing.serverName) || '',
        userId: r.User.Id,
        userName: r.User.Name,
        accessToken: r.AccessToken,
        userImageTag: r.User.PrimaryImageTag,
        isAdmin: r.User.Policy?.IsAdministrator,
        lastUsed: Date.now(),
      });
    },
    [server, activate],
  );

  const selectProfile = useCallback(
    (id: string) => {
      const p = profilesRef.current.find((x) => x.id === id);
      if (!p) return false;
      if (!p.accessToken) {
        setServer({ url: p.serverUrl, id: p.serverId, name: p.serverName, version: '' });
        return false;
      }
      activate(p);
      return true;
    },
    [activate, setServer],
  );

  const leaveProfile = useCallback(() => {
    setSession(null);
    api.configure(api.baseUrl);
  }, []);

  const removeProfile = useCallback(
    async (id: string) => {
      const p = profilesRef.current.find((x) => x.id === id);
      if (p && p.accessToken) {
        const c = new JellyfinApi();
        c.configure(p.serverUrl, p.accessToken, p.userId);
        await c.logout().catch(() => {});
      }
      persist(profilesRef.current.filter((x) => x.id !== id));
      if (sessionRef.current && sessionRef.current.id === id) {
        api.configure(api.baseUrl);
        setSession(null);
      }
    },
    [persist],
  );

  const logout = useCallback(async () => {
    const cur = sessionRef.current;
    if (cur) await removeProfile(cur.id);
  }, [removeProfile]);

  const value = useMemo(
    () => ({ server, session, profiles, setServer, completeLogin, selectProfile, leaveProfile, logout, removeProfile, updateProfile }),
    [server, session, profiles, setServer, completeLogin, selectProfile, leaveProfile, logout, removeProfile, updateProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
