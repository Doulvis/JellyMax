import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backdropUrl, logoUrl } from '../api/images';
import { resolvePlayable } from '../api/playable';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { formatRuntime, yearLabel } from '../utils/format';
import { isMobile, isTV, keyName } from '../platform';
import { ChevronLeft, ChevronRight, Info, Play } from './Icons';

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
  return isMobile ? <SwipeHero items={items} /> : <Hero items={items} />;
}

/** Boutons "Lecture" et "Plus d'infos" d'un titre de la bannière. */
function HeroActions({ item }: { item: BaseItem }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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
    <div className="hero__actions">
      <button className="btn btn--primary btn--lg" onClick={play} disabled={busy}>
        <Play /> {t('hero.play')}
      </button>
      <Link className="btn btn--ghost btn--lg" to={`/item/${item.Id}`}>
        <Info /> {t('hero.moreInfo')}
      </Link>
    </div>
  );
}

/**
 * Mobile : bannière qu'on fait glisser au doigt d'un titre à l'autre (défilement natif aimanté),
 * qui avance seule toutes les 9 s tant qu'on ne la touche pas.
 */
function SwipeHero({ items }: { items: BaseItem[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);
  const [wait, setWait] = useState(0);

  // Titre affiché, déduit de la position du défilement.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        setIndex(Math.max(0, Math.min(items.length - 1, i)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items.length]);

  const goTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    if (touching || items.length < 2) return;
    const timer = setTimeout(() => {
      // Pas de changement quand la bannière est hors de l'écran.
      if (window.scrollY > window.innerHeight * 0.5) setWait((w) => w + 1);
      else goTo((index + 1) % items.length);
    }, 9000);
    return () => clearTimeout(timer);
  }, [index, touching, items.length, wait]);

  return (
    <section className="hero hero-swipe" onTouchStart={() => setTouching(true)} onTouchEnd={() => setTouching(false)}>
      <div className="hero-swipe__track" ref={track}>
        {items.map((it, i) => {
          const bd = backdropUrl(it, 1280);
          const logo = logoUrl(it, 600);
          return (
            <div key={it.Id} className="hero-swipe__slide" aria-hidden={i !== index}>
              <Link className="hero-swipe__bg" to={`/item/${it.Id}`} tabIndex={-1}>
                {bd && <img src={bd} alt="" loading={Math.abs(i - index) > 1 ? 'lazy' : undefined} />}
              </Link>
              <div className="hero__shade" />
              <div className="hero__content">
                {logo ? <img className="hero__logo" src={logo} alt={it.Name} /> : <h1 className="hero__title">{it.Name}</h1>}
                <MetaLine item={it} />
                <HeroActions item={it} />
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 1 && (
        <div className="hero__dots">
          {items.map((it, i) => (
            <button
              key={it.Id}
              tabIndex={-1}
              className={i === index ? 'is-active' : ''}
              onClick={() => goTo(i)}
              aria-label={t('hero.show', { name: it.Name })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function Hero({ items }: { items: BaseItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
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

  // TV : on précharge les images voisines pour un changement instantané (automatique ou à la télécommande).
  useEffect(() => {
    if (!isTV || items.length < 2) return;
    const next = backdropUrl(items[(index + 1) % items.length], HERO_WIDTH);
    if (next) new Image().src = next;
    const prev = backdropUrl(items[(index - 1 + items.length) % items.length], HERO_WIDTH);
    if (prev && items.length > 2) new Image().src = prev;
  }, [index, items]);

  const item = items[index];
  if (!item) return null;
  const logo = logoUrl(item, isTV ? 500 : 700);
  const step = (d: number) => setIndex((i) => (i + d + items.length) % items.length);

  // TV : ▶ depuis le dernier bouton passe au titre suivant, ◀ depuis le premier revient au précédent
  // (sur le premier titre, ◀ ouvre toujours la barre latérale). Le focus reste sur le même bouton.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isTV || items.length < 2 || e.repeat) return;
    const k = keyName(e.nativeEvent);
    const target = e.target as HTMLElement;
    const actions = target.parentElement;
    if (!actions || !actions.classList.contains('hero__actions')) return;
    if (k === 'ArrowRight' && target === actions.lastElementChild) {
      e.preventDefault();
      step(1);
    } else if (k === 'ArrowLeft' && target === actions.firstElementChild && index > 0) {
      e.preventDefault();
      step(-1);
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
      onKeyDown={isTV ? onKeyDown : undefined}
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
      {/* TV : pas de remontage du contenu, pour que le bouton sélectionné garde le focus. */}
      <div className="hero__content" key={isTV ? undefined : item.Id}>
        {logo ? <img className="hero__logo" src={logo} alt={item.Name} /> : <h1 className="hero__title">{item.Name}</h1>}
        <MetaLine item={item} />
        {item.Overview && <p className="hero__overview">{item.Overview}</p>}
        <HeroActions item={item} />
      </div>
      {/* PC : flèches discrètes qui n'apparaissent qu'à l'approche de la souris. */}
      {!isTV && items.length > 1 && (
        <>
          <button className="hero__arrow hero__arrow--left" tabIndex={-1} onClick={() => step(-1)} aria-label={t('common.prev')}>
            <span className="rail__arrow-btn">
              <ChevronLeft />
            </span>
          </button>
          <button className="hero__arrow hero__arrow--right" tabIndex={-1} onClick={() => step(1)} aria-label={t('common.next')}>
            <span className="rail__arrow-btn">
              <ChevronRight />
            </span>
          </button>
        </>
      )}
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
