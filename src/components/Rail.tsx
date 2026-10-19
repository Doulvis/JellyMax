import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BaseItem } from '../api/types';
import { t } from '../i18n';
import { isTV } from '../platform';
import { Card, type CardVariant } from './Card';
import { ChevronLeft, ChevronRight } from './Icons';

export interface RailProps {
  title: string;
  items: BaseItem[];
  variant?: CardVariant;
  action?: 'detail' | 'play';
  to?: string;
  onMore?: () => void;
}

export function Rail({ title, items, variant = 'landscape', action = 'detail', to, onMore }: RailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    // TV : pas de flèches de défilement (télécommande), donc rien à suivre pendant le défilement.
    if (isTV) return;
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update, items]);

  const scroll = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (!items.length) return null;
  return (
    <section className="rail">
      <div className="rail__head">
        <h2>{title}</h2>
        {to && (
          <Link className="rail__more" to={to} tabIndex={-1}>
            {t('common.seeAll')} <ChevronRight />
          </Link>
        )}
        {!to && onMore && (
          <button className="rail__more" onClick={onMore} tabIndex={-1}>
            {t('common.seeAll')} <ChevronRight />
          </button>
        )}
      </div>
      <div className="rail__wrap">
        {canLeft && (
          <button className="rail__arrow rail__arrow--left" tabIndex={-1} onClick={() => scroll(-1)} aria-label={t('common.prev')}>
            <span className="rail__arrow-btn">
              <ChevronLeft />
            </span>
          </button>
        )}
        <div className={`rail__track rail__track--${variant}`} ref={ref}>
          {items.map((it) => (
            <Card key={it.Id} item={it} variant={variant} action={action} />
          ))}
        </div>
        {canRight && (
          <button className="rail__arrow rail__arrow--right" tabIndex={-1} onClick={() => scroll(1)} aria-label={t('common.next')}>
            <span className="rail__arrow-btn">
              <ChevronRight />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

export function RailSkeleton({ title, variant = 'landscape' }: { title: string; variant?: CardVariant }) {
  return (
    <section className="rail" aria-busy="true">
      <div className="rail__head">
        <h2>{title}</h2>
      </div>
      <div className="rail__wrap">
        <div className={`rail__track rail__track--${variant}`}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`card card--${variant} skeleton`}>
              <div className="card__frame" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type LoadResult = BaseItem[] | { title: string; items: BaseItem[] };

/**
 * Carrousel qui charge son contenu lui-même : immédiatement (eager) ou à l'approche de l'écran.
 * Un carrousel en échec ou vide disparaît sans affecter le reste de la page.
 */
export function LazyRail({
  load,
  title,
  eager,
  skeleton = true,
  minItems = 1,
  ...rest
}: Omit<RailProps, 'items'> & {
  load: () => Promise<LoadResult>;
  eager?: boolean;
  skeleton?: boolean;
  minItems?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [data, setData] = useState<{ title: string; items: BaseItem[] } | null>(null);

  useEffect(() => {
    let alive = true;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      loadRef.current().then(
        (r) => {
          if (alive) setData(Array.isArray(r) ? { title, items: r } : r);
        },
        () => {
          if (alive) setData({ title, items: [] });
        },
      );
    };
    if (eager || typeof IntersectionObserver === 'undefined') {
      run();
      return () => {
        alive = false;
      };
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          run();
        }
      },
      { rootMargin: '700px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data && data.items.length < minItems) return null;
  return (
    <div ref={ref} className="lazy-rail">
      {data ? (
        <Rail {...rest} title={data.title} items={data.items} />
      ) : skeleton ? (
        <RailSkeleton title={title} variant={rest.variant} />
      ) : (
        <div className="rail-placeholder" />
      )}
    </div>
  );
}
