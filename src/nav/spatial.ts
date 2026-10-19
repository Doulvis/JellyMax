// Navigation spatiale : les flèches (clavier ou télécommande TV) déplacent le focus
// vers l'élément le plus proche dans la direction demandée.

import { isTV, keyName } from '../platform';

type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

interface Cand {
  el: HTMLElement;
  r: DOMRect;
}

const SIDENAV = '.sidenav';

/** Un conteneur [data-nav-scope] (menu, panneau…) restreint la navigation à son contenu. */
function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]');
  return scopes.length ? scopes[scopes.length - 1] : document;
}

/**
 * Éléments focalisables visibles, avec leur position (lue une seule fois par appui de touche).
 * Pas de getComputedStyle : trop coûteux sur TV avec des centaines de cartes.
 */
function candidates(root: ParentNode = scopeRoot()): Cand[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  const hasHidden = !!document.querySelector('[data-nav-hidden]');
  const out: Cand[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.getAttribute('tabindex') === '-1') continue;
    if (hasHidden && el.closest('[data-nav-hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push({ el, r });
  }
  return out;
}

function rectInViewport(r: DOMRect) {
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

let scrollAnim = 0;

/**
 * Défilement vertical animé de la page (TV). Le défilement natif "smooth" s'accumule quand on enchaîne
 * les appuis ; ici chaque appui reprend l'animation depuis la position actuelle, avec une durée courte.
 */
export function animateScrollTo(target: number, duration = 220) {
  if (scrollAnim) cancelAnimationFrame(scrollAnim);
  scrollAnim = 0;
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const to = Math.max(0, Math.min(max, Math.round(target)));
  const from = window.scrollY;
  if (Math.abs(to - from) < 2) return;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    window.scrollTo(0, Math.round(from + (to - from) * eased));
    scrollAnim = p < 1 ? requestAnimationFrame(step) : 0;
  };
  scrollAnim = requestAnimationFrame(step);
}

function focusEl(el: HTMLElement, dir: Dir | null, instant: boolean) {
  if (!el.closest(SIDENAV)) lastMain = el;
  el.focus({ preventScroll: true });
  const vertical = dir === 'up' || dir === 'down';
  // TV, changement de carrousel : alignement horizontal immédiat puis défilement vertical animé.
  if (isTV && vertical && !instant && scopeRoot() === document && el.closest('.rail, .hero')) {
    const from = window.scrollY;
    if (scrollAnim) cancelAnimationFrame(scrollAnim);
    scrollAnim = 0;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const target = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
    window.scrollTo(0, from);
    animateScrollTo(target);
    return;
  }
  if (isTV && scrollAnim) {
    cancelAnimationFrame(scrollAnim);
    scrollAnim = 0;
  }
  // TV : défilement immédiat ailleurs, l'animation fluide native est trop coûteuse pour le processeur des TV.
  const behavior = instant || isTV ? 'auto' : 'smooth';
  // Options d'une liste déroulante : on ne recentre pas la page à chaque option.
  const block = vertical && !el.closest('.dropdown__menu') ? 'center' : 'nearest';
  try {
    el.scrollIntoView({ block, inline: 'nearest', behavior });
  } catch {
    el.scrollIntoView(false);
  }
}

function overlapGap(a1: number, a2: number, b1: number, b2: number) {
  if (b2 < a1) return a1 - b2;
  if (b1 > a2) return b1 - a2;
  return 0;
}

/** Dernier élément focalisé hors de la barre latérale : on y revient avec ▶. */
let lastMain: HTMLElement | null = null;

function pick(list: Cand[], cur: HTMLElement, c: DOMRect, dir: Dir): HTMLElement | null {
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r } of list) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
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
  return best;
}

/** Carte voisine dans le même carrousel : réponse immédiate, sans parcourir la page. */
function railSibling(cur: HTMLElement, dir: Dir): HTMLElement | null {
  if (dir !== 'left' && dir !== 'right') return null;
  const track = cur.parentElement;
  if (!track || !track.classList.contains('rail__track')) return null;
  const next = (dir === 'right' ? cur.nextElementSibling : cur.previousElementSibling) as HTMLElement | null;
  return next && next.matches(FOCUSABLE) ? next : null;
}

export function moveFocus(dir: Dir, instant = false): boolean {
  const cur = document.activeElement as HTMLElement | null;
  const hasCur = !!cur && cur !== document.body && document.body.contains(cur);

  if (hasCur) {
    const sib = railSibling(cur!, dir);
    if (sib) {
      focusEl(sib, dir, instant);
      return true;
    }
  }

  const scope = scopeRoot();
  const inSide = hasCur && scope === document && !!cur!.closest(SIDENAV);

  // Dans la barre latérale : ▲ ▼ restent dans la barre, ▶ revient au contenu.
  if (inSide && dir === 'right') {
    if (lastMain && document.body.contains(lastMain) && rectInViewport(lastMain.getBoundingClientRect())) {
      focusEl(lastMain, null, true);
      return true;
    }
    const main = document.querySelector('main');
    const list = main ? candidates(main).filter((c) => rectInViewport(c.r)) : [];
    if (list.length) {
      focusEl(list[0].el, null, true);
      return true;
    }
    return false;
  }

  let list = inSide ? candidates(document.querySelector(SIDENAV)!) : candidates(scope);
  if (!list.length) return false;
  if (!hasCur || !list.some((c) => c.el === cur)) {
    const first = list.find((c) => rectInViewport(c.r) && !c.el.closest(SIDENAV)) || list.find((c) => rectInViewport(c.r)) || list[0];
    focusEl(first.el, null, instant);
    return true;
  }
  // Hors de la barre latérale, seule ◀ peut y entrer (▲ ▼ ne doivent jamais l'ouvrir).
  if (!inSide && scope === document) {
    const content = list.filter((c) => !c.el.closest(SIDENAV));
    if (dir !== 'left') list = content;
    else {
      // ◀ ne reste dans le contenu que vers un élément de la même ligne ; sinon (début d'un carrousel,
      // première colonne d'une grille…) on passe à la barre latérale, sur la rubrique de la page actuelle.
      const c = cur!.getBoundingClientRect();
      const sameRow = content.filter((x) => overlapGap(c.top, c.bottom, x.r.top, x.r.bottom) === 0);
      const target = pick(sameRow, cur!, c, dir);
      if (target) {
        focusEl(target, dir, instant);
        return true;
      }
      const side = document.querySelector<HTMLElement>(`${SIDENAV} .sidenav__item.active`) ||
        document.querySelector<HTMLElement>(`${SIDENAV} .sidenav__item`);
      if (side) {
        focusEl(side, dir, instant);
        return true;
      }
    }
  }
  const best = pick(list, cur!, cur!.getBoundingClientRect(), dir);
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
  const visible = list.filter((c) => rectInViewport(c.r)).map((c) => c.el);
  const preferred =
    visible.find((el) => el.hasAttribute('data-autofocus')) ||
    visible.find((el) => !!el.closest('main')) ||
    visible[0] ||
    list[0].el;
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

let lastRepeat = 0;

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
      // Touche maintenue : on limite la cadence pour que la TV ne prenne pas de retard sur la télécommande.
      if (e.repeat && isTV) {
        const now = Date.now();
        if (now - lastRepeat < 110) {
          e.preventDefault();
          return;
        }
        lastRepeat = now;
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
