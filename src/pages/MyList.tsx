import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BaseItem } from '../api/types';
import { Empty, ErrorState, PageLoader } from '../components/Common';
import { Heart } from '../components/Icons';
import { Rail } from '../components/Rail';
import { t } from '../i18n';
import { errorMessage } from '../utils/format';

/** Ma liste : tous les médias "aimés" (favoris Jellyfin), rangés par type. */
export default function MyList() {
  const [items, setItems] = useState<BaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setError(null);
    api
      .items({
        isFavorite: true,
        recursive: true,
        includeItemTypes: 'Movie,Series,Episode,BoxSet',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 500,
      })
      .then((r) => setItems(r.Items))
      .catch((e) => setError(errorMessage(e)));
  }, [reload]);

  if (error) return <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />;
  if (!items) return <PageLoader />;

  const by = (t: string) => items.filter((i) => i.Type === t);
  const movies = by('Movie');
  const series = by('Series');
  const episodes = by('Episode');
  const sets = by('BoxSet');

  return (
    <div className="page-flush">
      <div className="page-head">
        <h1 className="page__title">{t('nav.mylist')}</h1>
        <p className="page__sub">{items.length === 1 ? t('mylist.count1') : t('mylist.countN', { n: items.length })}</p>
      </div>
      {items.length === 0 ? (
        <Empty>
          <Heart className="empty__icon" />
          <br />
          {t('mylist.empty')}
        </Empty>
      ) : (
        <div className="rails">
          <Rail title={t('type.movies')} items={movies} />
          <Rail title={t('type.shows')} items={series} />
          <Rail title={t('type.episodes')} items={episodes} />
          <Rail title={t('type.collections')} items={sets} />
        </div>
      )}
    </div>
  );
}
