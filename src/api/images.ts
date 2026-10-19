import { api } from './client';
import type { BaseItem, Person } from './types';

/** Affiche verticale (2:3). Pour un épisode, on prend l'affiche de la série. */
export function posterUrl(item: BaseItem, w = 400): string | null {
  const tags = item.ImageTags || {};
  if (item.Type === 'Episode' && item.SeriesId && item.SeriesPrimaryImageTag) {
    return api.imageUrl(item.SeriesId, 'Primary', { tag: item.SeriesPrimaryImageTag, maxWidth: w });
  }
  if (tags.Primary) return api.imageUrl(item.Id, 'Primary', { tag: tags.Primary, maxWidth: w });
  if (item.SeriesId && item.SeriesPrimaryImageTag) {
    return api.imageUrl(item.SeriesId, 'Primary', { tag: item.SeriesPrimaryImageTag, maxWidth: w });
  }
  return null;
}

/**
 * Vignette horizontale (16:9).
 * kind = 'art' : l'image contient déjà le titre (Thumb, capture d'épisode) ;
 * kind = 'backdrop' : image "nue" sur laquelle on superpose le logo du titre.
 */
export function landscapeImage(item: BaseItem, w = 640): { url: string; kind: 'art' | 'backdrop' } | null {
  const tags = item.ImageTags || {};
  if (item.Type === 'Episode' && tags.Primary) {
    return { url: api.imageUrl(item.Id, 'Primary', { tag: tags.Primary, maxWidth: w }), kind: 'art' };
  }
  if (tags.Thumb) return { url: api.imageUrl(item.Id, 'Thumb', { tag: tags.Thumb, maxWidth: w }), kind: 'art' };
  if (item.BackdropImageTags && item.BackdropImageTags.length) {
    return {
      url: api.imageUrl(item.Id, 'Backdrop', { tag: item.BackdropImageTags[0], maxWidth: w, index: 0 }),
      kind: 'backdrop',
    };
  }
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return {
      url: api.imageUrl(item.ParentThumbItemId, 'Thumb', { tag: item.ParentThumbImageTag, maxWidth: w }),
      kind: 'art',
    };
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
    return {
      url: api.imageUrl(item.ParentBackdropItemId, 'Backdrop', {
        tag: item.ParentBackdropImageTags[0],
        maxWidth: w,
        index: 0,
      }),
      kind: 'backdrop',
    };
  }
  if (tags.Primary) return { url: api.imageUrl(item.Id, 'Primary', { tag: tags.Primary, maxWidth: w }), kind: 'backdrop' };
  return null;
}

export function landscapeUrl(item: BaseItem, w = 640): string | null {
  const img = landscapeImage(item, w);
  return img ? img.url : null;
}

/** Grande image de fond. */
export function backdropUrl(item: BaseItem, w = 1920): string | null {
  if (item.BackdropImageTags && item.BackdropImageTags.length) {
    return api.imageUrl(item.Id, 'Backdrop', { tag: item.BackdropImageTags[0], maxWidth: w, index: 0, quality: 85 });
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
    return api.imageUrl(item.ParentBackdropItemId, 'Backdrop', {
      tag: item.ParentBackdropImageTags[0],
      maxWidth: w,
      index: 0,
      quality: 85,
    });
  }
  if (item.Type === 'Episode' && item.ImageTags && item.ImageTags.Primary) {
    return api.imageUrl(item.Id, 'Primary', { tag: item.ImageTags.Primary, maxWidth: w, quality: 85 });
  }
  return null;
}

/** Logo du titre (image transparente). */
export function logoUrl(item: BaseItem, w = 700): string | null {
  if (item.ImageTags && item.ImageTags.Logo) return api.imageUrl(item.Id, 'Logo', { tag: item.ImageTags.Logo, maxWidth: w });
  if (item.ParentLogoItemId && item.ParentLogoImageTag) {
    return api.imageUrl(item.ParentLogoItemId, 'Logo', { tag: item.ParentLogoImageTag, maxWidth: w });
  }
  return null;
}

export function personImageUrl(p: Person, w = 300): string | null {
  return p.PrimaryImageTag ? api.imageUrl(p.Id, 'Primary', { tag: p.PrimaryImageTag, maxWidth: w }) : null;
}
