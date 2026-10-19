import { api } from './client';
import type { BaseItem } from './types';
import { settle } from '../utils/format';

/** Premier épisode "normal" d'une série (hors épisodes spéciaux / saison 0). */
export async function firstEpisode(seriesId: string): Promise<BaseItem | null> {
  const r = await api.episodes(seriesId);
  const items = r.Items || [];
  return items.find((e) => (e.ParentIndexNumber ?? 1) > 0) || items[0] || null;
}

/** Détermine l'élément réellement lu quand on appuie sur "Lecture". */
export async function resolvePlayable(item: BaseItem): Promise<BaseItem | null> {
  if (item.Type === 'Series') {
    const next = await settle(api.nextUp({ seriesId: item.Id, limit: 1, enableResumable: true }));
    if (next && next.Items && next.Items[0]) return next.Items[0];
    return firstEpisode(item.Id);
  }
  if (item.Type === 'BoxSet') {
    const r = await api.items({ parentId: item.Id, sortBy: 'PremiereDate,ProductionYear,SortName', limit: 100 });
    const playable = r.Items.filter((i) => i.Type === 'Movie' || i.Type === 'Episode' || i.Type === 'Video');
    return playable.find((i) => !(i.UserData && i.UserData.Played)) || playable[0] || null;
  }
  return item;
}
