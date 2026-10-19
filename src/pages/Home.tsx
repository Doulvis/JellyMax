import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { getRecommendations, heroItems, latestItems, topRated, byGenre } from '../api/recommend';
import type { BaseItem } from '../api/types';
import { HeroLoader } from '../components/Hero';
import { LazyRail } from '../components/Rail';
import { t } from '../i18n';
import { shuffle } from '../utils/format';

export default function Home() {
  // Une seule requête de recommandations partagée par les deux carrousels qui en dépendent.
  const reco = useMemo(() => getRecommendations(['Movie', 'Series']), []);
  const [genres, setGenres] = useState<BaseItem[]>([]);

  useEffect(() => {
    api
      .genres({ includeItemTypes: 'Movie,Series' })
      .then((r) => setGenres(shuffle(r.Items || []).slice(0, 4)))
      .catch(() => {});
  }, []);

  return (
    <div className="home">
      <HeroLoader load={() => heroItems('Movie,Series')} />
      <div className="rails">
        <LazyRail eager skeleton={false} title={t('rail.resume')} action="play" load={() => api.resume(24).then((r) => r.Items)} />
        <LazyRail
          eager
          skeleton={false}
          title={t('rail.nextUp')}
          action="play"
          load={() => api.nextUp({ limit: 24, enableResumable: false }).then((r) => r.Items)}
        />
        <LazyRail eager title={t('rail.recommended')} load={() => reco.then((r) => r.items)} />
        <LazyRail
          eager
          skeleton={false}
          title=""
          load={() =>
            reco.then((r) => (r.because ? { title: t('rail.because', { name: r.because.source }), items: r.because.items } : []))
          }
        />
        <LazyRail eager title={t('rail.newMovies')} to="/movies" load={() => latestItems('Movie')} />
        <LazyRail eager title={t('rail.newShows')} to="/shows" load={() => latestItems('Series')} />
        <LazyRail
          skeleton={false}
          title={t('rail.myList')}
          to="/mylist"
          load={() =>
            api
              .items({ isFavorite: true, includeItemTypes: 'Movie,Series', recursive: true, sortBy: 'DateCreated', sortOrder: 'Descending', limit: 24 })
              .then((r) => r.Items)
          }
        />
        <LazyRail title={t('rail.topRated')} load={() => topRated('Movie,Series')} />
        {genres.map((g) => (
          <LazyRail key={g.Id} title={g.Name} minItems={4} load={() => byGenre(g.Id, 'Movie,Series')} />
        ))}
      </div>
    </div>
  );
}
