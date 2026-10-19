import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { BaseItem } from '../api/types';
import { locale, t } from '../i18n';
import { errorMessage } from '../utils/format';
import { ItemGrid } from './Card';
import { Dropdown, Empty, Spinner } from './Common';

type SortKey = 'added' | 'az' | 'year' | 'rating' | 'random';
type FilterKey = 'all' | 'unplayed' | 'favorites';

const PAGE = 48;

const SORT_KEYS: SortKey[] = ['added', 'az', 'year', 'rating', 'random'];
const SORT_LABEL = { added: 'sort.added', az: 'sort.az', year: 'sort.year', rating: 'sort.rating', random: 'sort.random' } as const;
const FILTER_KEYS: FilterKey[] = ['all', 'unplayed', 'favorites'];
const FILTER_LABEL = { all: 'filter.all', unplayed: 'filter.unplayed', favorites: 'filter.favorites' } as const;

function sortParams(sort: SortKey, types: string) {
  switch (sort) {
    case 'az':
      return { sortBy: 'SortName', sortOrder: 'Ascending' };
    case 'year':
      return { sortBy: 'PremiereDate,ProductionYear,SortName', sortOrder: 'Descending' };
    case 'rating':
      return { sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' };
    case 'random':
      return { sortBy: 'Random', sortOrder: 'Ascending' };
    default:
      return {
        sortBy: types === 'Series' ? 'DateLastContentAdded,SortName' : 'DateCreated,SortName',
        sortOrder: 'Descending',
      };
  }
}

/** Grille complète d'un catalogue : tri, filtre, genres, défilement infini. */
export function BrowseGrid({
  title,
  types,
  parentId,
  genres,
  genre,
  onGenre,
}: {
  title: string;
  types: string;
  parentId?: string;
  genres: BaseItem[];
  genre: string;
  onGenre(id: string): void;
}) {
  const [sort, setSort] = useState<SortKey>('az');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [items, setItems] = useState<BaseItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  const stateRef = useRef({ count: 0, total: 0, loading: false });
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqRef.current;
      const start = reset ? 0 : stateRef.current.count;
      stateRef.current.loading = true;
      setLoading(true);
      if (reset) setError(null);
      try {
        const r = await api.items({
          parentId,
          includeItemTypes: types,
          recursive: true,
          startIndex: start,
          limit: PAGE,
          genreIds: genre || undefined,
          isPlayed: filter === 'unplayed' ? false : undefined,
          isFavorite: filter === 'favorites' ? true : undefined,
          ...sortParams(sort, types),
        });
        if (id !== reqRef.current) return;
        setItems((cur) => {
          const next = reset ? r.Items : cur.concat(r.Items);
          stateRef.current.count = next.length;
          return next;
        });
        setTotal(r.TotalRecordCount);
        stateRef.current.total = r.TotalRecordCount;
      } catch (e) {
        if (id === reqRef.current) setError(errorMessage(e));
      } finally {
        if (id === reqRef.current) {
          stateRef.current.loading = false;
          setLoading(false);
        }
      }
    },
    [types, parentId, sort, filter, genre],
  );

  useEffect(() => {
    stateRef.current.count = 0;
    setItems([]);
    setTotal(null);
    load(true);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const s = stateRef.current;
        if (entries[0].isIntersecting && !s.loading && s.count < s.total) load(false);
      },
      { rootMargin: '900px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  return (
    <div className="browse">
      <div className="browse__head">
        <h2>{title}</h2>
        <div className="toolbar">
          <Dropdown
            label={t('browse.sort')}
            value={sort}
            options={SORT_KEYS.map((k) => ({ value: k, label: t(SORT_LABEL[k]) }))}
            onChange={(v) => setSort(v)}
          />
          <Dropdown
            label={t('browse.show')}
            value={filter}
            options={FILTER_KEYS.map((k) => ({ value: k, label: t(FILTER_LABEL[k]) }))}
            onChange={(v) => setFilter(v)}
          />
          {total != null && <span className="toolbar__count">{t('browse.count', { n: total.toLocaleString(locale()) })}</span>}
        </div>
      </div>
      {genres.length > 0 && (
        <div className="chips">
          <button className={`chip ${genre === '' ? 'is-active' : ''}`} onClick={() => onGenre('')}>
            {t('browse.allGenres')}
          </button>
          {genres.map((g) => (
            <button key={g.Id} className={`chip ${genre === g.Id ? 'is-active' : ''}`} onClick={() => onGenre(g.Id)}>
              {g.Name}
            </button>
          ))}
        </div>
      )}
      {error && !items.length && (
        <Empty>
          {error}{' '}
          <button className="link-btn" onClick={() => load(true)}>
            {t('common.retry')}
          </button>
        </Empty>
      )}
      {items.length > 0 && <ItemGrid items={items} />}
      {!loading && !error && total === 0 && <Empty>{t('browse.noMatch')}</Empty>}
      <div ref={sentinel} className="sentinel">
        {loading && <Spinner />}
      </div>
    </div>
  );
}
