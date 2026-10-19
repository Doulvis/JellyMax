import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { backdropUrl } from '../api/images';
import type { BaseItem } from '../api/types';
import { Empty, Spinner } from '../components/Common';
import { Search as SearchIcon } from '../components/Icons';
import { LazyRail, Rail } from '../components/Rail';
import { t } from '../i18n';

interface Results {
  movies: BaseItem[];
  series: BaseItem[];
  episodes: BaseItem[];
  collections: BaseItem[];
  people: BaseItem[];
  genres: BaseItem[];
}

const EMPTY: Results = { movies: [], series: [], episodes: [], collections: [], people: [], genres: [] };

/** Recherche dans tout le catalogue : films, séries, épisodes, collections, personnes et genres. */
export default function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [allGenres, setAllGenres] = useState<BaseItem[]>([]);
  const reqRef = useRef(0);

  useEffect(() => {
    api
      .genres({ includeItemTypes: 'Movie,Series' })
      .then((r) => setAllGenres(r.Items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const term = q.trim();
    setSp(term ? { q: term } : {}, { replace: true });
    if (!term) {
      reqRef.current++;
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const id = ++reqRef.current;
      const [items, people, genres] = await Promise.all([
        api
          .items({ searchTerm: term, recursive: true, includeItemTypes: 'Movie,Series,Episode,BoxSet', limit: 150 })
          .then((r) => r.Items, () => [] as BaseItem[]),
        api.persons(term, 20).then((r) => r.Items, () => [] as BaseItem[]),
        api.genres({ searchTerm: term, includeItemTypes: 'Movie,Series', limit: 12 }).then((r) => r.Items, () => [] as BaseItem[]),
      ]);
      if (id !== reqRef.current) return;
      const by = (type: string) => items.filter((i) => i.Type === type);
      setResults({
        movies: by('Movie'),
        series: by('Series'),
        episodes: by('Episode'),
        collections: by('BoxSet'),
        people,
        genres,
      });
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const r = results || EMPTY;
  const total = r.movies.length + r.series.length + r.episodes.length + r.collections.length + r.people.length + r.genres.length;

  return (
    <div className="page-flush">
      <div className="page-head">
        <div className="search-box">
          <SearchIcon />
          <input
            autoFocus
            type="search"
            placeholder={t('search.placeholder')}
            value={q}
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('search.label')}
          />
          {loading && <Spinner size="sm" />}
        </div>
      </div>

      {!results && (
        <>
          {allGenres.length > 0 && (
            <div className="page-head">
              <h2 className="section-title">{t('search.browseGenres')}</h2>
              <GenreTiles genres={allGenres} />
            </div>
          )}
          <div className="rails">
            <LazyRail eager title={t('rail.discover')} load={() => api.items({ includeItemTypes: 'Movie,Series', recursive: true, sortBy: 'Random', limit: 24 }).then((x) => x.Items)} />
          </div>
        </>
      )}

      {results && total === 0 && !loading && <Empty>{t('search.noResults', { q: q.trim() })}</Empty>}

      {results && (
        <div className="rails">
          {r.genres.length > 0 && (
            <div className="page-head page-head--tight">
              <h2 className="section-title">{t('type.genres')}</h2>
              <GenreTiles genres={r.genres} />
            </div>
          )}
          <Rail title={t('type.movies')} items={r.movies} />
          <Rail title={t('type.shows')} items={r.series} />
          {r.people.length > 0 && (
            <section className="rail">
              <div className="rail__head">
                <h2>{t('type.people')}</h2>
              </div>
              <div className="cast cast--rail">
                {r.people.map((p) => {
                  const tag = p.ImageTags && p.ImageTags.Primary;
                  const img = tag ? api.imageUrl(p.Id, 'Primary', { tag, maxWidth: 300 }) : null;
                  return (
                    <Link key={p.Id} to={`/person/${p.Id}`} className="cast__item">
                      <div className="cast__img">{img ? <img src={img} alt="" loading="lazy" /> : p.Name.charAt(0)}</div>
                      <div className="cast__name">{p.Name}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          <Rail title={t('type.episodes')} items={r.episodes} action="play" />
          <Rail title={t('type.collections')} items={r.collections} />
        </div>
      )}
    </div>
  );
}

function GenreTiles({ genres }: { genres: BaseItem[] }) {
  return (
    <div className="genre-tiles">
      {genres.map((g, i) => (
        <GenreTile key={g.Id} genre={g} tint={i % 6} />
      ))}
    </div>
  );
}

/**
 * Tuile de genre illustrée par l'image d'un titre de ce genre (chargée à l'approche de l'écran).
 * Le lien mène à la page Films, ou Séries si le genre ne contient que des séries.
 */
function GenreTile({ genre, tint }: { genre: BaseItem; tint: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [art, setArt] = useState<string | null>(null);
  const [section, setSection] = useState<'movies' | 'shows'>('movies');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const pick = async () => {
      const query = (type: string) =>
        api
          .items({ genreIds: genre.Id, includeItemTypes: type, recursive: true, imageTypes: 'Backdrop', sortBy: 'Random', limit: 1 })
          .then((r) => r.Items[0] as BaseItem | undefined, () => undefined);
      let it = await query('Movie');
      let where: 'movies' | 'shows' = 'movies';
      if (!it) {
        it = await query('Series');
        where = 'shows';
      }
      if (!alive) return;
      setSection(where);
      if (it) setArt(backdropUrl(it, 640));
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      pick();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          pick();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [genre.Id]);

  return (
    <Link ref={ref} to={`/${section}?genre=${genre.Id}`} className={`genre-tile genre-tile--${tint}`}>
      {art && <img src={art} alt="" loading="lazy" className={loaded ? 'is-loaded' : ''} onLoad={() => setLoaded(true)} />}
      <span className="genre-tile__tint" />
      <span className="genre-tile__name">{genre.Name}</span>
    </Link>
  );
}
