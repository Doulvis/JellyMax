import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { backdropUrl, landscapeUrl, logoUrl, personImageUrl } from '../api/images';
import { firstEpisode } from '../api/playable';
import type { BaseItem, UserData } from '../api/types';
import { ItemGrid } from '../components/Card';
import { Dropdown, Empty, ErrorState, PageLoader, Spinner, Tabs } from '../components/Common';
import { MetaLine } from '../components/Hero';
import { Check, Eye, Film, Heart, HeartFill, Play, Restart } from '../components/Icons';
import { t } from '../i18n';
import {
  episodeCode,
  errorMessage,
  formatDate,
  formatRuntime,
  qualityBadge,
  remainingLabel,
  settle,
  TPS,
} from '../utils/format';

type TabKey = 'episodes' | 'collection' | 'similar' | 'details';

interface PlayTarget {
  id: string;
  label: string;
  resumable: boolean;
  remaining: string;
  percent: number;
}

function targetFor(ep: BaseItem, prefix?: string): PlayTarget {
  const pos = (ep.UserData && ep.UserData.PlaybackPositionTicks) || 0;
  const resumable = pos > 0;
  const base = resumable ? t('detail.resume') : t('detail.play');
  return {
    id: ep.Id,
    label: prefix ? `${base} ${prefix}` : base,
    resumable,
    remaining: resumable ? remainingLabel(ep) : '',
    percent: (ep.UserData && ep.UserData.PlayedPercentage) || 0,
  };
}

export default function DetailRoute() {
  const { id = '' } = useParams();
  return <Detail key={id} id={id} />;
}

function Detail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [item, setItem] = useState<BaseItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .item(id)
      .then((it) => {
        if (!alive) return;
        if (it.Type === 'Season' && it.SeriesId) {
          navigate(`/item/${it.SeriesId}?season=${it.Id}`, { replace: true });
          return;
        }
        if (it.Type === 'Person') {
          navigate(`/person/${it.Id}`, { replace: true });
          return;
        }
        setItem(it);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, reload, navigate]);

  if (error) return <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />;
  if (!item) return <PageLoader />;
  return <ItemView item={item} initialSeason={sp.get('season')} />;
}

function ItemView({ item, initialSeason }: { item: BaseItem; initialSeason: string | null }) {
  const navigate = useNavigate();
  const isSeries = item.Type === 'Series';
  const isBoxSet = item.Type === 'BoxSet';
  const isEpisode = item.Type === 'Episode';

  const [ud, setUd] = useState<UserData>(item.UserData || {});
  const [target, setTarget] = useState<PlayTarget | null>(isSeries || isBoxSet ? null : targetFor(item));
  const [seasons, setSeasons] = useState<BaseItem[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(initialSeason);
  const [episodes, setEpisodes] = useState<BaseItem[] | null>(null);
  const [similar, setSimilar] = useState<BaseItem[] | null>(null);
  const [children, setChildren] = useState<BaseItem[] | null>(null);
  const [tab, setTab] = useState<TabKey>(isSeries ? 'episodes' : isBoxSet ? 'collection' : isEpisode ? 'details' : 'similar');

  // Séries : saisons + prochain épisode à lire.
  useEffect(() => {
    if (!isSeries) return;
    let alive = true;
    (async () => {
      const [ss, nu] = await Promise.all([settle(api.seasons(item.Id)), settle(api.nextUp({ seriesId: item.Id, limit: 1, enableResumable: true }))]);
      if (!alive) return;
      const list = (ss && ss.Items) || [];
      setSeasons(list);
      let ep: BaseItem | null = (nu && nu.Items[0]) || null;
      if (!ep) ep = await settle(firstEpisode(item.Id));
      if (!alive) return;
      if (ep) setTarget(targetFor(ep, episodeCode(ep)));
      setSeasonId((cur) => {
        if (cur && list.some((s) => s.Id === cur)) return cur;
        if (ep && ep.SeasonId && list.some((s) => s.Id === ep!.SeasonId)) return ep.SeasonId;
        const first = list.find((s) => (s.IndexNumber ?? 1) > 0) || list[0];
        return first ? first.Id : null;
      });
    })();
    return () => {
      alive = false;
    };
  }, [isSeries, item.Id]);

  useEffect(() => {
    if (!isSeries || !seasonId) return;
    let alive = true;
    setEpisodes(null);
    api
      .episodes(item.Id, { seasonId })
      .then((r) => alive && setEpisodes(r.Items || []))
      .catch(() => alive && setEpisodes([]));
    return () => {
      alive = false;
    };
  }, [isSeries, item.Id, seasonId]);

  // Collections : contenu + premier titre non vu.
  useEffect(() => {
    if (!isBoxSet) return;
    api
      .items({ parentId: item.Id, sortBy: 'PremiereDate,ProductionYear,SortName', sortOrder: 'Ascending', limit: 200 })
      .then((r) => {
        setChildren(r.Items);
        const playable = r.Items.filter((i) => i.Type === 'Movie' || i.Type === 'Video' || i.Type === 'Episode');
        const next = playable.find((i) => !(i.UserData && i.UserData.Played)) || playable[0];
        if (next) setTarget(targetFor(next));
      })
      .catch(() => setChildren([]));
  }, [isBoxSet, item.Id]);

  useEffect(() => {
    if (isBoxSet || isEpisode) return;
    api
      .similar(item.Id)
      .then((r) => setSimilar(r.Items))
      .catch(() => setSimilar([]));
  }, [isBoxSet, isEpisode, item.Id]);

  const toggleFavorite = async () => {
    const next = !ud.IsFavorite;
    setUd((u) => ({ ...u, IsFavorite: next }));
    try {
      const r = await api.setFavorite(item.Id, next);
      if (r) setUd(r);
    } catch {
      setUd((u) => ({ ...u, IsFavorite: !next }));
    }
  };

  const togglePlayed = async () => {
    const next = !ud.Played;
    setUd((u) => ({ ...u, Played: next }));
    try {
      const r = await api.setPlayed(item.Id, next);
      if (r) setUd(r);
      if (isSeries && episodes) setEpisodes(episodes.map((e) => ({ ...e, UserData: { ...e.UserData, Played: next, PlayedPercentage: 0 } })));
    } catch {
      setUd((u) => ({ ...u, Played: !next }));
    }
  };

  const toggleEpisodePlayed = async (ep: BaseItem) => {
    const next = !(ep.UserData && ep.UserData.Played);
    const apply = (played: boolean) =>
      setEpisodes((list) =>
        list ? list.map((e) => (e.Id === ep.Id ? { ...e, UserData: { ...e.UserData, Played: played } } : e)) : list,
      );
    apply(next);
    try {
      await api.setPlayed(ep.Id, next);
    } catch {
      apply(!next);
    }
  };

  const bd = backdropUrl(item);
  const logo = isEpisode ? null : logoUrl(item);
  const trailer = item.RemoteTrailers && item.RemoteTrailers[0] && item.RemoteTrailers[0].Url;
  const badges = qualityBadge(item);

  const tabs: { key: TabKey; label: string }[] = [];
  if (isSeries) tabs.push({ key: 'episodes', label: t('detail.episodes') });
  if (isBoxSet) tabs.push({ key: 'collection', label: t('detail.inCollection') });
  if (!isBoxSet && !isEpisode) tabs.push({ key: 'similar', label: t('detail.moreLikeThis') });
  tabs.push({ key: 'details', label: t('detail.details') });

  return (
    <div className="detail">
      {bd && (
        <div className="ambient ambient--detail" aria-hidden="true">
          <img src={backdropUrl(item, 480) || bd} alt="" className="is-active" />
        </div>
      )}
      <div className="detail__hero">
        <div className="detail__backdrop">{bd && <img src={bd} alt="" />}</div>
        <div className="detail__shade" />
        <div className="detail__content">
          {isEpisode && item.SeriesId && (
            <Link className="detail__series-link" to={`/item/${item.SeriesId}?season=${item.SeasonId || ''}`}>
              {item.SeriesName} · {episodeCode(item)}
            </Link>
          )}
          {logo ? <img className="detail__logo" src={logo} alt={item.Name} /> : <h1 className="detail__title">{item.Name}</h1>}
          <MetaLine item={item} />
          {badges.length > 0 && (
            <div className="meta meta--badges">
              {badges.map((b) => (
                <span key={b} className="badge badge--solid">
                  {b}
                </span>
              ))}
            </div>
          )}
          {item.Taglines && item.Taglines[0] && <p className="detail__tagline">{item.Taglines[0]}</p>}
          {item.Overview && <p className="detail__overview">{item.Overview}</p>}

          <div className="detail__actions">
            <button
              className="btn btn--primary btn--lg"
              disabled={!target}
              onClick={() => target && navigate(`/play/${target.id}`)}
            >
              {target ? <Play /> : <Spinner size="sm" />} {target ? target.label : t('detail.play')}
            </button>
            {target && target.resumable && (
              <button className="btn btn--ghost btn--lg" onClick={() => navigate(`/play/${target.id}?t=0`)}>
                <Restart /> {t('detail.restart')}
              </button>
            )}
            <button className={`icon-pill ${ud.IsFavorite ? 'is-on' : ''}`} onClick={toggleFavorite}>
              {ud.IsFavorite ? <HeartFill /> : <Heart />}
              <span>{t('detail.myList')}</span>
            </button>
            {!isBoxSet && (
              <button className={`icon-pill ${ud.Played ? 'is-on' : ''}`} onClick={togglePlayed}>
                <Eye />
                <span>{ud.Played ? t('detail.watched') : t('detail.markWatched')}</span>
              </button>
            )}
            {trailer && (
              <button className="icon-pill" onClick={() => window.open(trailer, '_blank')}>
                <Film />
                <span>{t('detail.trailer')}</span>
              </button>
            )}
          </div>
          {target && target.percent > 0 && target.percent < 100 && (
            <div className="detail__progress">
              <div className="bar">
                <span style={{ width: `${target.percent}%` }} />
              </div>
              <span>{target.remaining}</span>
            </div>
          )}
        </div>
      </div>

      <div className="detail__body">
        <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v)} />

        {tab === 'episodes' && (
          <div className="episodes">
            <div className="episodes__head">
              {seasons.length > 0 && seasonId && (
                <Dropdown value={seasonId} options={seasons.map((s) => ({ value: s.Id, label: s.Name }))} onChange={(v) => setSeasonId(v)} />
              )}
              {episodes && (
                <span>{episodes.length === 1 ? t('detail.episodeCount1') : t('detail.episodeCountN', { n: episodes.length })}</span>
              )}
            </div>
            {episodes === null ? (
              <div className="center-pad">
                <Spinner />
              </div>
            ) : episodes.length === 0 ? (
              <Empty>{t('detail.noEpisodes')}</Empty>
            ) : (
              <div className="episodes__list">
                {episodes.map((ep) => (
                  <EpisodeRow key={ep.Id} ep={ep} onTogglePlayed={() => toggleEpisodePlayed(ep)} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'collection' &&
          (children === null ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : (
            <ItemGrid items={children} />
          ))}

        {tab === 'similar' &&
          (similar === null ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : similar.length ? (
            <ItemGrid items={similar} />
          ) : (
            <Empty>{t('detail.noSimilar')}</Empty>
          ))}

        {tab === 'details' && <DetailsSection item={item} />}
      </div>
    </div>
  );
}

function EpisodeRow({ ep, onTogglePlayed }: { ep: BaseItem; onTogglePlayed(): void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const img = landscapeUrl(ep, 480);
  const ud = ep.UserData || {};
  const pct = ud.PlayedPercentage || 0;
  const meta = [formatRuntime(ep.RunTimeTicks), formatDate(ep.PremiereDate)].filter(Boolean).join(' · ');
  return (
    <div className="ep">
      <Link to={`/play/${ep.Id}`} className="ep__thumb" aria-label={t('detail.playItem', { name: ep.Name })}>
        {img && !imgFailed && <img src={img} alt="" loading="lazy" onError={() => setImgFailed(true)} />}
        {pct > 0 && pct < 100 && (
          <div className="card__progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <span className="ep__play">
          <Play />
        </span>
      </Link>
      <div className="ep__info">
        <div className="ep__title">
          {ep.IndexNumber != null ? `${ep.IndexNumber}. ` : ''}
          {ep.Name}
        </div>
        {meta && <div className="ep__meta">{meta}</div>}
        {ep.Overview && <p className="ep__overview">{ep.Overview}</p>}
      </div>
      <button
        className={`ep__watched ${ud.Played ? 'is-on' : ''}`}
        onClick={onTogglePlayed}
        aria-label={ud.Played ? t('detail.markUnwatched') : t('detail.markAsWatched')}
        title={ud.Played ? t('detail.watched') : t('detail.markAsWatched')}
      >
        <Check />
      </button>
    </div>
  );
}

function langList(item: BaseItem, type: string) {
  const streams =
    item.MediaStreams || (item.MediaSources && item.MediaSources[0] && item.MediaSources[0].MediaStreams) || [];
  const seen: string[] = [];
  streams
    .filter((s) => s.Type === type)
    .forEach((s) => {
      const label = s.Language ? s.Language.toUpperCase() : s.DisplayTitle || '';
      if (label && seen.indexOf(label) < 0) seen.push(label);
    });
  return seen.join(', ');
}

function DetailsSection({ item }: { item: BaseItem }) {
  const people = item.People || [];
  const directors = people.filter((p) => p.Type === 'Director').map((p) => p.Name);
  const writers = people.filter((p) => p.Type === 'Writer').map((p) => p.Name);
  const cast = people.filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar').slice(0, 30);
  const facts: [string, string][] = [];
  if (item.Genres && item.Genres.length) facts.push([t('fact.genres'), item.Genres.join(', ')]);
  if (directors.length) facts.push([t('fact.director'), directors.join(', ')]);
  if (writers.length) facts.push([t('fact.writers'), writers.join(', ')]);
  if (item.Studios && item.Studios.length) facts.push([t('fact.studio'), item.Studios.map((s) => s.Name).join(', ')]);
  if (item.PremiereDate) facts.push([t('fact.release'), formatDate(item.PremiereDate)]);
  if (item.RunTimeTicks) facts.push([t('fact.runtime'), formatRuntime(item.RunTimeTicks)]);
  const audio = langList(item, 'Audio');
  const subs = langList(item, 'Subtitle');
  if (audio) facts.push([t('fact.audio'), audio]);
  if (subs) facts.push([t('fact.subtitles'), subs]);
  if (item.OriginalTitle && item.OriginalTitle !== item.Name) facts.push([t('fact.originalTitle'), item.OriginalTitle]);
  if (item.UserData && item.UserData.PlaybackPositionTicks) {
    facts.push([t('fact.position'), formatRuntime(item.UserData.PlaybackPositionTicks)]);
  }

  return (
    <div className="details">
      <div>
        <h3>{item.Name}</h3>
        <p>{item.Overview || t('detail.noOverview')}</p>
      </div>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k} className="facts__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {cast.length > 0 && (
        <div className="cast-block">
          <h3>{t('detail.cast')}</h3>
          <div className="cast">
            {cast.map((p) => {
              const img = personImageUrl(p);
              return (
                <Link key={p.Id + (p.Role || '')} to={`/person/${p.Id}`} className="cast__item">
                  <div className="cast__img">{img ? <img src={img} alt="" loading="lazy" /> : p.Name.charAt(0)}</div>
                  <div className="cast__name">{p.Name}</div>
                  {p.Role && <div className="cast__role">{p.Role}</div>}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
