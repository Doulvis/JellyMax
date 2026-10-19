import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backdropUrl, logoUrl } from '../api/images';
import { resolvePlayable } from '../api/playable';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { formatRuntime, yearLabel } from '../utils/format';
import { isTV } from '../platform';
import { Info, Play } from './Icons';

const HERO_WIDTH = isTV ? 1280 : 1920;

export function MetaLine({ item }: { item: BaseItem }) {
  const parts: ReactNode[] = [];
  const year = yearLabel(item);
  if (year) parts.push(<span key="y">{year}</span>);
  if (item.OfficialRating) parts.push(<span key="r" className="badge">{item.OfficialRating}</span>);
  if (item.Type === 'Series' && item.ChildCount) {
    parts.push(<span key="s">{item.ChildCount > 1 ? t('meta.seasons', { n: item.ChildCount }) : t('meta.season1')}</span>);
  } else if (item.RunTimeTicks) parts.push(<span key="d">{formatRuntime(item.RunTimeTicks)}</span>);
  if (item.CommunityRating) {
    parts.push(
      <span key="c" className="meta__rating">
        ★ {item.CommunityRating.toFixed(1)}
      </span>,
    );
  }
  if (item.Genres && item.Genres.length) parts.push(<span key="g">{item.Genres.slice(0, 3).join(', ')}</span>);
  return <div className="meta">{parts}</div>;
}

/** Carrousel principal qui charge ses titres lui-même. */
export function HeroLoader({ load }: { load: () => Promise<BaseItem[]> }) {
  const [items, setItems] = useState<BaseItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (i) => alive && setItems(i),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (items === null) return <section className="hero hero--loading" />;
  if (!items.length) return <div className="hero-spacer" />;
  return <Hero items={items} />;
}

export function Hero({ items }: { items: BaseItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = setTimeout(() => {
      // TV : pas de changement de bannière (et de décodage d'image) quand elle est hors de l'écran.
      if (isTV && window.scrollY > window.innerHeight * 0.5) setWait((w) => w + 1);
      else setIndex((i) => (i + 1) % items.length);
    }, isTV ? 10000 : 9000);
    return () => clearTimeout(t);
  }, [index, paused, items.length, wait]);

  // TV : on précharge l'image suivante pour un changement instantané.
  useEffect(() => {
    if (!isTV || items.length < 2) return;
    const next = backdropUrl(items[(index + 1) % items.length], HERO_WIDTH);
    if (next) new Image().src = next;
  }, [index, items]);

  const item = items[index];
  if (!item) return null;
  const logo = logoUrl(item, isTV ? 500 : 700);

  const play = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const target = await resolvePlayable(item);
      if (target) navigate(`/play/${target.Id}`);
      else navigate(`/item/${item.Id}`);
    } catch {
      navigate(`/item/${item.Id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <section
      className={`hero ${paused ? 'is-paused' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // TV : le bouton Lecture a le focus dès l'ouverture, la bannière doit quand même défiler.
      onFocus={isTV ? undefined : () => setPaused(true)}
      onBlur={isTV ? undefined : () => setPaused(false)}
    >
      {items.map((it, i) => {
        // TV : une seule grande image en mémoire (celle affichée), sans fondu enchaîné.
        if (isTV && i !== index) return null;
        const bd = backdropUrl(it, HERO_WIDTH);
        return (
          <div key={it.Id} className={`hero__bg ${i === index ? 'is-active' : ''}`} aria-hidden={i !== index}>
            {bd && <img src={bd} alt="" />}
          </div>
        );
      })}
      <div className="hero__shade" />
      <div className="hero__content" key={item.Id}>
        {logo ? <img className="hero__logo" src={logo} alt={item.Name} /> : <h1 className="hero__title">{item.Name}</h1>}
        <MetaLine item={item} />
        {item.Overview && <p className="hero__overview">{item.Overview}</p>}
        <div className="hero__actions">
          <button className="btn btn--primary btn--lg" onClick={play} disabled={busy}>
            <Play /> {t('hero.play')}
          </button>
          <Link className="btn btn--ghost btn--lg" to={`/item/${item.Id}`}>
            <Info /> {t('hero.moreInfo')}
          </Link>
        </div>
      </div>
      {items.length > 1 && (
        <div className="hero__dots">
          {items.map((it, i) => (
            <button
              key={it.Id}
              tabIndex={-1}
              className={i === index ? 'is-active' : ''}
              onClick={() => setIndex(i)}
              aria-label={t('hero.show', { name: it.Name })}
            />
          ))}
        </div>
      )}
    </section>
    </>
  );
}
