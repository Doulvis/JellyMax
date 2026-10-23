import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { landscapeImage, logoUrl, posterUrl } from '../api/images';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { isTV } from '../platform';
import { episodeCode, remainingLabel } from '../utils/format';
import { Check, Play } from './Icons';

export type CardVariant = 'poster' | 'landscape';

export function itemLink(item: BaseItem): string {
  if (item.Type === 'Season' && item.SeriesId) return `/item/${item.SeriesId}?season=${item.Id}`;
  if (item.Type === 'Person') return `/person/${item.Id}`;
  return `/item/${item.Id}`;
}

function titles(item: BaseItem, action: 'detail' | 'play'): [string, string] {
  if (item.Type === 'Episode') {
    return [item.SeriesName || item.Name, [episodeCode(item), item.Name].filter(Boolean).join(' · ')];
  }
  if (action === 'play') return [item.Name, remainingLabel(item) || String(item.ProductionYear || '')];
  return [item.Name, item.ProductionYear ? String(item.ProductionYear) : ''];
}

// TV : images juste à la taille affichée (les cartes font ~400 px de large en 1080p), décodage plus rapide.
const POSTER_W = isTV ? 260 : 360;
const LANDSCAPE_W = isTV ? 440 : 640;
const LOGO_W = isTV ? 280 : 400;

/** Mémorisée : un carrousel qui se met à jour ne redessine pas toutes ses cartes. */
export const Card = memo(function Card({
  item,
  variant = 'landscape',
  action = 'detail',
  showTitle,
}: {
  item: BaseItem;
  variant?: CardVariant;
  action?: 'detail' | 'play';
  showTitle?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const ud = item.UserData || {};
  const pct = ud.PlayedPercentage || 0;
  const to = action === 'play' ? `/play/${item.Id}` : itemLink(item);
  const [title, sub] = titles(item, action);

  let src: string | null = null;
  let needsBrand = false;
  if (variant === 'poster') {
    src = posterUrl(item, POSTER_W);
  } else {
    const img = landscapeImage(item, LANDSCAPE_W);
    src = img ? img.url : null;
    needsBrand = item.Type !== 'Episode' && (!img || img.kind === 'backdrop' || imgFailed);
  }
  const logo = needsBrand && !logoFailed ? logoUrl(item, LOGO_W) : null;
  const withMeta = showTitle || action === 'play' || item.Type === 'Episode';

  return (
    <Link to={to} className={`card card--${variant}`} title={title}>
      <div className="card__frame">
        {variant === 'poster' && <div className="card__fallback">{title}</div>}
        {src && !imgFailed && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)} />}
        {needsBrand && (
          <div className="card__brand">
            {logo ? <img src={logo} alt="" loading="lazy" onError={() => setLogoFailed(true)} /> : <span>{item.Name}</span>}
          </div>
        )}
        {ud.Played && action !== 'play' && (
          <span className="card__badge" aria-label={t('common.watched')}>
            <Check />
          </span>
        )}
        {item.Type === 'Series' && !!ud.UnplayedItemCount && <span className="card__count">{ud.UnplayedItemCount}</span>}
        {pct > 0 && pct < 100 && (
          <div className="card__progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        {action === 'play' && (
          <span className="card__play">
            <Play />
          </span>
        )}
      </div>
      {withMeta && (
        <div className="card__meta">
          <div className="card__title">{title}</div>
          {sub && <div className="card__sub">{sub}</div>}
        </div>
      )}
    </Link>
  );
});

export function ItemGrid({ items, variant = 'landscape', showTitle }: { items: BaseItem[]; variant?: CardVariant; showTitle?: boolean }) {
  return (
    <div className={`grid grid--${variant}`}>
      {items.map((it) => (
        <Card key={it.Id} item={it} variant={variant} showTitle={showTitle} />
      ))}
    </div>
  );
}

export function PosterGrid({ items, showTitle }: { items: BaseItem[]; showTitle?: boolean }) {
  return <ItemGrid items={items} variant="poster" showTitle={showTitle} />;
}
