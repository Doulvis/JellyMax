import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { byGenre, getRecommendations, heroItems, latestItems, topRated, type MediaKind } from '../api/recommend';
import type { BaseItem } from '../api/types';
import { BrowseGrid } from '../components/BrowseGrid';
import { HeroLoader } from '../components/Hero';
import { LazyRail } from '../components/Rail';
import { t } from '../i18n';

/** Pages Films et Séries : reprise, recommandations, nouveautés, un carrousel par genre, puis le catalogue complet. */
export default function Catalog({ kind }: { kind: 'movies' | 'shows' }) {
  return <CatalogView key={kind} kind={kind} />;
}

function CatalogView({ kind }: { kind: 'movies' | 'shows' }) {
  const type: MediaKind = kind === 'movies' ? 'Movie' : 'Series';
  const isMovies = kind === 'movies';
  const [sp, setSp] = useSearchParams();
  const reco = useMemo(() => getRecommendations([type]), [type]);
  const [genres, setGenres] = useState<BaseItem[]>([]);
  const [genre, setGenre] = useState(sp.get('genre') || '');
  const browseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .genres({ includeItemTypes: type })
      .then((r) => setGenres(r.Items || []))
      .catch(() => {});
  }, [type]);

  // Arrivée depuis un lien "genre" (ex. la recherche) : on va directement au catalogue filtré.
  useEffect(() => {
    if (!sp.get('genre')) return;
    const t = window.setTimeout(() => browseRef.current && browseRef.current.scrollIntoView({ behavior: 'smooth' }), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showGenre = (id: string) => {
    setGenre(id);
    setSp(id ? { genre: id } : {}, { replace: true });
    if (browseRef.current) browseRef.current.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="catalog">
      <HeroLoader load={() => heroItems(type)} />
      <div className="rails">
        {isMovies ? (
          <LazyRail eager skeleton={false} title={t('rail.resumeShort')} action="play" load={() => api.resume(24, 'Movie').then((r) => r.Items)} />
        ) : (
          <>
            <LazyRail eager skeleton={false} title={t('rail.resumeShort')} action="play" load={() => api.resume(24, 'Episode').then((r) => r.Items)} />
            <LazyRail
              eager
              skeleton={false}
              title={t('rail.nextUp')}
              action="play"
              load={() => api.nextUp({ limit: 24, enableResumable: false }).then((r) => r.Items)}
            />
          </>
        )}
        <LazyRail eager title={t('rail.recommended')} load={() => reco.then((r) => r.items)} />
        <LazyRail
          eager
          skeleton={false}
          title=""
          load={() =>
            reco.then((r) => (r.because ? { title: t('rail.because', { name: r.because.source }), items: r.because.items } : []))
          }
        />
        <LazyRail eager title={isMovies ? t('rail.newMovies') : t('rail.newEpisodes')} load={() => latestItems(type)} />
        <LazyRail title={t('rail.topRated')} load={() => topRated(type)} />
        {genres.map((g) => (
          <LazyRail key={g.Id} title={g.Name} minItems={3} onMore={() => showGenre(g.Id)} load={() => byGenre(g.Id, type)} />
        ))}
        <div ref={browseRef} className="browse-anchor">
          <BrowseGrid
            title={isMovies ? t('browse.allMovies') : t('browse.allShows')}
            types={type}
            genres={genres}
            genre={genre}
            onGenre={showGenre}
          />
        </div>
      </div>
    </div>
  );
}
