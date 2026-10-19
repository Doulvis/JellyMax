// Navigation spatiale : les flèches (clavier ou télécommande TV) déplacent le focus
// vers l'élément le plus proche dans la direction demandée.

import { isTV, keyName } from '../platform';

type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function isCandidate(el: HTMLElement): boolean {
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.closest('[data-nav-hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** Un conteneur [data-nav-scope] (menu, panneau…) restreint la navigation à son contenu. */
function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]');
  return scopes.length ? scopes[scopes.length - 1] : document;
}

function candidates(): HTMLElement[] {
  return Array.prototype.slice.call(scopeRoot().querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isCandidate);
}

function inViewport(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

function focusEl(el: HTMLElement, dir: Dir | null, instant: boolean) {
  el.focus({ preventScroll: true });
  const vertical = dir === 'up' || dir === 'down';
  try {
    el.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'nearest', behavior: instant ? 'auto' : 'smooth' });
  } catch {
    el.scrollIntoView(false);
  }
}

function overlapGap(a1: number, a2: number, b1: number, b2: number) {
  if (b2 < a1) return a1 - b2;
  if (b1 > a2) return b1 - a2;
  return 0;
}

export function moveFocus(dir: Dir, instant = false): boolean {
  const list = candidates();
  if (!list.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || list.indexOf(cur) < 0) {
    focusEl(list.find(inViewport) || list[0], null, instant);
    return true;
  }
  const c = cur.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let score: number;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? x <= cx + 1 : x >= cx - 1) continue;
      const primary = Math.max(0, dir === 'right' ? r.left - c.right : c.left - r.right);
      const gap = overlapGap(c.top, c.bottom, r.top, r.bottom);
      score = primary + gap * 6 + Math.abs(y - cy) * 0.15;
    } else {
      if (dir === 'down' ? y <= cy + 1 : y >= cy - 1) continue;
      const primary = Math.max(0, dir === 'down' ? r.top - c.bottom : c.top - r.bottom);
      score = primary * 3 + Math.abs(x - cx);
    }
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  focusEl(best, dir, instant);
  return true;
}

function isTextField(el: Element | null): el is HTMLInputElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
}

/** Place le focus sur un élément visible quand plus rien n'a le focus (TV : pas de souris pour le faire). */
function ensureFocus() {
  const cur = document.activeElement as HTMLElement | null;
  if (cur && cur !== document.body && document.body.contains(cur)) return;
  const list = candidates();
  if (!list.length) return;
  const visible = list.filter(inViewport);
  const preferred =
    visible.find((el) => el.hasAttribute('data-autofocus')) ||
    visible.find((el) => !!el.closest('main')) ||
    visible[0] ||
    list[0];
  focusEl(preferred, null, true);
}

/**
 * TV : un champ de texte reçoit le focus en lecture seule pour que le clavier virtuel ne s'ouvre pas
 * à chaque passage ; OK l'ouvre pour saisir.
 */
function initTvTextFields() {
  document.addEventListener('focusin', (e) => {
    const el = e.target as Element;
    if (isTextField(el) && !el.dataset.imeOpen) el.readOnly = true;
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target as Element;
    if (isTextField(el) && el.dataset.imeOpen) {
      delete el.dataset.imeOpen;
      el.readOnly = false;
    }
  });
  window.addEventListener(
    'keydown',
    (e) => {
      const el = document.activeElement;
      if (!isTextField(el)) return;
      const k = keyName(e);
      if (k === 'Enter' && el.readOnly) {
        e.preventDefault();
        e.stopPropagation();
        el.readOnly = false;
        el.blur();
        el.dataset.imeOpen = '1';
        el.focus();
      } else if (e.keyCode === 65376 || e.keyCode === 65385) {
        // "Terminé" / "Annuler" du clavier virtuel : retour à la navigation.
        delete el.dataset.imeOpen;
        el.readOnly = true;
      }
    },
    true,
  );
}

export function initSpatialNav() {
  // Mode "clavier / télécommande" : certains effets (ex. barre latérale ouverte au focus) ne s'appliquent qu'à ce mode.
  const root = document.documentElement;
  window.addEventListener(
    'keydown',
    (e) => {
      const k = keyName(e);
      if (KEY_DIR[k] || k === 'Tab' || k === 'Enter') root.classList.add('kbd-nav');
    },
    true,
  );
  if (!isTV) {
    const toMouse = () => {
      if (root.classList.contains('kbd-nav')) root.classList.remove('kbd-nav');
    };
    window.addEventListener('mousedown', toMouse, true);
    window.addEventListener('mousemove', toMouse, true);
  } else {
    initTvTextFields();
    window.setInterval(ensureFocus, 400);
  }

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement as HTMLElement | null;
    const key = keyName(e);
    const dir = KEY_DIR[key];
    if (dir) {
      if (active && active.tagName === 'SELECT') return;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && !(active as HTMLInputElement).readOnly) {
        const input = active as HTMLInputElement;
        if (input.type === 'range') {
          if (dir === 'left' || dir === 'right') return;
        } else if (dir === 'left' || dir === 'right') {
          // Laisse le curseur se déplacer dans le texte, sauf aux extrémités.
          const start = input.selectionStart;
          const end = input.selectionEnd;
          if (start != null && end != null) {
            if (dir === 'left' && (start > 0 || end > 0)) return;
            if (dir === 'right' && start < input.value.length) return;
          }
        }
      }
      if (moveFocus(dir, e.repeat)) e.preventDefault();
      return;
    }
    if (key === 'Enter' && active && active !== document.body) {
      const tag = active.tagName;
      if (tag !== 'A' && tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        active.click();
        e.preventDefault();
      }
    }
  });
}
