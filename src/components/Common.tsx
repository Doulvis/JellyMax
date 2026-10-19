import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { t } from '../i18n';
import { animateScrollTo } from '../nav/spatial';
import { isBackKey, isTV } from '../platform';
import { Check, ChevronDown } from './Icons';

/** Méduse du logo JellyMax, en vectoriel. */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="jm-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3f6ff" />
          <stop offset="0.55" stopColor="#a6dff7" />
          <stop offset="1" stopColor="#3fb8f0" />
        </linearGradient>
      </defs>
      <g stroke="url(#jm-mark)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M27.5 9.2C19 10.6 13.2 18.4 13.2 27.6v1.8c0 2.8 2.4 4.4 5 3.4 4.4-1.8 9-2.6 13.8-2.6s9.4.8 13.8 2.6c2.6 1 5-.6 5-3.4v-1.8c0-9.2-5.8-17-14.3-18.4" />
        <path d="M18.6 27c.4-5.4 3.6-10 8.4-12" />
        <path d="M22.5 34.5c0 6.5-7.5 8.2-7.5 14.5 0 3.3 2.2 5.5 5 6" />
        <path d="M28.5 34c0 6.5-6 9.4-6 15.5 0 2.6 1 4.4 2.4 5.4" />
        <path d="M33.5 31.5c.8 7.8-6.5 11.8-6.5 20 0 5 3 8.6 7.5 10" />
        <path d="M41 34.5c1 6.8-5 9.6-5 16.2 0 3.6 2.2 6.2 5.2 7.3" />
      </g>
      <circle cx="32" cy="8.2" r="2.6" fill="#e3f6ff" />
    </svg>
  );
}

export function Logo({ className = '', withMark = false }: { className?: string; withMark?: boolean }) {
  return (
    <span className={`logo ${className}`} aria-label="JellyMax">
      {withMark && <LogoMark />}
      <span>
        Jelly<b>MAX</b>
      </span>
    </span>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`spinner spinner--${size}`} role="status" aria-label={t('common.loading')} />;
}

export function PageLoader() {
  return (
    <div className="page-loader">
      <Spinner size="lg" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <h2>{t('common.oops')}</h2>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn--primary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#2b4bff,#7b3cff)',
  'linear-gradient(135deg,#ff3c7a,#ff9a3c)',
  'linear-gradient(135deg,#00b4a6,#2b7bff)',
  'linear-gradient(135deg,#8a3cff,#ff3cbe)',
  'linear-gradient(135deg,#ffb800,#ff4b2b)',
  'linear-gradient(135deg,#22c55e,#0ea5e9)',
];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  userId,
  tag,
  name,
  size,
  server,
}: {
  userId?: string;
  tag?: string;
  name: string;
  size?: 'sm' | 'lg' | 'xl';
  /** Adresse du serveur du profil (par défaut : le serveur actif). */
  server?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tag]);
  const src = userId && tag && !failed ? api.userImageUrl(userId, tag, server || api.baseUrl) : null;
  return (
    <div className={`avatar ${size ? `avatar--${size}` : ''}`} style={src ? undefined : { background: colorFor(name) }}>
      {src ? <img src={src} alt="" onError={() => setFailed(true)} /> : (name.charAt(0) || '?').toUpperCase()}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      className={`switch ${on ? 'is-on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

export interface Option<T> {
  value: T;
  label: string;
}

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  label,
  align = 'left',
}: {
  value: T;
  options: Option<T>[];
  onChange(v: T): void;
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        const btn = ref.current && (ref.current.querySelector('.dropdown__btn') as HTMLElement | null);
        if (btn) btn.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    const raf = requestAnimationFrame(() => {
      const el =
        ref.current &&
        ((ref.current.querySelector('.dropdown__opt.is-active') as HTMLElement | null) ||
          (ref.current.querySelector('.dropdown__opt') as HTMLElement | null));
      if (el) el.focus({ preventScroll: isTV });
      // TV : la page descend pour que la liste ouverte soit entièrement visible.
      const menu = isTV && ref.current && (ref.current.querySelector('.dropdown__menu') as HTMLElement | null);
      if (menu) {
        const overflow = menu.getBoundingClientRect().bottom + 32 - window.innerHeight;
        if (overflow > 0) animateScrollTo(window.scrollY + overflow);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  return (
    <div className="dropdown" ref={ref}>
      <button className="dropdown__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {label && <span className="dropdown__label">{label}</span>}
        <span>{current ? current.label : '—'}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className={`dropdown__menu dropdown__menu--${align}`} role="listbox" data-nav-scope>
          {options.map((o) => (
            <button
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown__opt ${o.value === value ? 'is-active' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange(v: T): void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === value}
          className={`tabs__btn ${t.key === value ? 'is-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
