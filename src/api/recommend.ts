import { api } from './client';
import type { BaseItem } from './types';
import { settle, shuffle } from '../utils/format';

export type MediaKind = 'Movie' | 'Series';

interface Seed {
  id: string;
  name: string;
}

export interface Recommendations {
  items: BaseItem[];
  because: { source: string; items: BaseItem[] } | null;
}

/** Derniers titres regardés, qui servent de base aux recommandations. */
async function seedsFor(kind: MediaKind): Promise<Seed[]> {
  if (kind === 'Movie') {
    const r = await settle(
      api.items({
        includeItemTypes: 'Movie',
        recursive: true,
        isPlayed: true,
        sortBy: 'DatePlayed',
        sortOrder: 'Descending',
        limit: 6,
      }),
    );
    return r ? r.Items.map((i) => ({ id: i.Id, name: i.Name })) : [];
  }
  // Séries : on remonte des derniers épisodes vus vers leur série.
  const r = await settle(
    api.items({
      includeItemTypes: 'Episode',
      recursive: true,
      isPlayed: true,
      sortBy: 'DatePlayed',
      sortOrder: 'Descending',
      limit: 60,
    }),
  );
  const out: Seed[] = [];
  if (r) {
    for (const ep of r.Items) {
      if (ep.SeriesId && !out.some((s) => s.id === ep.SeriesId)) out.push({ id: ep.SeriesId, name: ep.SeriesName || '' });
      if (out.length >= 6) break;
    }
  }
  return out;
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/**
 * Recommandations "à la HBO Max" : titres similaires à ce que l'utilisateur a regardé récemment,
 * non encore vus. Repli sur les titres les mieux notés quand l'historique est vide.
 */
export async function getRecommendations(kinds: MediaKind[], limit = 24): Promise<Recommendations> {
  const [movies, series] = await Promise.all([
    kinds.indexOf('Movie') >= 0 ? seedsFor('Movie') : Promise.resolve([] as Seed[]),
    kinds.indexOf('Series') >= 0 ? seedsFor('Series') : Promise.resolve([] as Seed[]),
  ]);
  const seeds = interleave(movies, series).slice(0, 6);
  const sims = await Promise.all(seeds.map((s) => settle(api.similar(s.id, 16))));
  const seen = new Set<string>(seeds.map((s) => s.id));
  const pools = sims.map((r) =>
    (r ? r.Items : []).filter((i) => kinds.indexOf(i.Type as MediaKind) >= 0 && !(i.UserData && i.UserData.Played)),
  );

  let because: Recommendations['because'] = null;
  if (seeds[0] && pools[0] && pools[0].length >= 4) {
    because = { source: seeds[0].name, items: pools[0] };
    pools[0].forEach((i) => seen.add(i.Id));
  }

  const items: BaseItem[] = [];
  const usable = because ? pools.slice(1) : pools;
  for (let round = 0; items.length < limit && round < 16; round++) {
    for (const pool of usable) {
      const it = pool[round];
      if (it && !seen.has(it.Id)) {
        seen.add(it.Id);
        items.push(it);
      }
    }
  }

  if (items.length < 10) {
    const top = await settle(
      api.items({
        includeItemTypes: kinds.join(','),
        recursive: true,
        isPlayed: false,
        sortBy: 'CommunityRating',
        sortOrder: 'Descending',
        limit: 60,
      }),
    );
    if (top) {
      for (const it of shuffle(top.Items)) {
        if (items.length >= limit) break;
        if (!seen.has(it.Id)) {
          seen.add(it.Id);
          items.push(it);
        }
      }
    }
  }
  return { items, because };
}

/** Titres du carrousel principal : avec image de fond, ceux qui ont un logo en premier. */
export async function heroItems(types: string): Promise<BaseItem[]> {
  const r = await api.items({
    includeItemTypes: types,
    recursive: true,
    sortBy: 'Random',
    limit: 24,
    imageTypes: 'Backdrop',
    fields: 'Overview,Genres,ChildCount',
  });
  return r.Items.slice()
    .sort((a, b) => (a.ImageTags && a.ImageTags.Logo ? 0 : 1) - (b.ImageTags && b.ImageTags.Logo ? 0 : 1))
    .slice(0, 7);
}

export async function latestItems(type: MediaKind, limit = 24): Promise<BaseItem[]> {
  const r = await api.items({
    includeItemTypes: type,
    recursive: true,
    sortBy: type === 'Series' ? 'DateLastContentAdded,SortName' : 'DateCreated,SortName',
    sortOrder: 'Descending',
    limit,
  });
  return r.Items;
}

export async function topRated(types: string, limit = 24): Promise<BaseItem[]> {
  const r = await api.items({
    includeItemTypes: types,
    recursive: true,
    sortBy: 'CommunityRating,SortName',
    sortOrder: 'Descending',
    limit,
  });
  return r.Items;
}

export async function byGenre(genreId: string, types: string, limit = 24): Promise<BaseItem[]> {
  const r = await api.items({ genreIds: genreId, includeItemTypes: types, recursive: true, sortBy: 'Random', limit });
  return r.Items;
}
