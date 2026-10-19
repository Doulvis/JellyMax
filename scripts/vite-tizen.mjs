// Build TV Samsung (Tizen) : `vite build --mode tizen` produit dist-tizen/, prêt à être empaqueté en .wgt.
//  - hls.js retiré (lecteur HLS natif de la TV) ;
//  - un seul script classique (pas de module ES : les anciennes TV les refusent en file://) ;
//  - JavaScript et CSS ramenés au niveau de Chromium 69 (TV 2020) ;
//  - `:focus-visible` remplacé par `:focus` (tout passe par la télécommande) ;
//  - marges de repli pour `gap` dans les conteneurs flex, ignoré avant Chromium 84 ;
//  - config.xml et icône copiés à côté de l'application.
import fs from 'node:fs';
import path from 'node:path';

export const TIZEN_OUT_DIR = 'dist-tizen';
const TARGET = 'chrome69';

export function tizenPlugin() {
  let outDir = TIZEN_OUT_DIR;
  return {
    name: 'jellymax-tizen',
    enforce: 'post',
    apply: (_config, env) => env.mode === 'tizen',
    config: (config) => ({
      resolve: {
        // Lecture HLS native sur TV : hls.js est remplacé par un module vide.
        alias: { 'hls.js': path.resolve(config.root || process.cwd(), 'src/hls-stub.ts') },
      },
      build: {
        outDir: TIZEN_OUT_DIR,
        target: TARGET,
        cssTarget: TARGET,
        modulePreload: false,
        cssCodeSplit: false,
        rollupOptions: {
          output: {
            format: 'iife',
            inlineDynamicImports: true,
          },
        },
      },
    }),
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // webapis.js (fourni par la TV) : mise en veille de l'écran pendant la lecture.
        return html
          .replace('<script type="module" crossorigin src=', '<script src="$WEBAPIS/webapis/webapis.js"></script>\n    <script defer src=')
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=');
      },
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css = typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8');
          file.source = adaptCss(css);
        }
      }
    },
    closeBundle() {
      const root = process.cwd();
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const xml = fs.readFileSync(path.join(root, 'tizen', 'config.xml'), 'utf8').replace('__VERSION__', pkg.version);
      fs.writeFileSync(path.join(outDir, 'config.xml'), xml);
      fs.copyFileSync(path.join(root, 'tizen', 'icon.png'), path.join(outDir, 'icon.png'));
    },
  };
}

// ---------------------------------------------------------------------------
// Adaptation de la feuille de style (CSS minifiée)
// ---------------------------------------------------------------------------

function adaptCss(css) {
  css = css.replace(/:focus-visible/g, ':focus');
  const nodes = parse(css);
  const layout = collectLayout(nodes);
  return print(nodes, layout);
}

/** Découpe une feuille en règles `{ prelude, body }` (blocs @media / @supports analysés récursivement). */
function parse(css) {
  const nodes = [];
  let i = 0;
  while (i < css.length) {
    const open = scan(css, i, '{;');
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    if (css[open] === ';') {
      nodes.push({ raw: css.slice(i, open + 1) });
      i = open + 1;
      continue;
    }
    const close = matching(css, open);
    const body = css.slice(open + 1, close);
    if (/^@(media|supports)/i.test(prelude)) nodes.push({ prelude, children: parse(body) });
    else if (prelude.charAt(0) === '@') nodes.push({ raw: css.slice(i, close + 1) });
    else nodes.push({ prelude, body, decls: declarations(body) });
    i = close + 1;
  }
  return nodes;
}

/** Position du premier caractère de `chars` hors chaînes et parenthèses. */
function scan(s, from, chars) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && chars.indexOf(c) >= 0) return i;
  }
  return -1;
}

function matching(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; ) {
    const j = scan(s, i, '{}');
    if (j < 0) break;
    depth += s[j] === '{' ? 1 : -1;
    if (depth === 0) return j;
    i = j + 1;
  }
  return s.length - 1;
}

function declarations(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    let end = scan(body, i, ';');
    if (end < 0) end = body.length;
    const decl = body.slice(i, end);
    const colon = decl.indexOf(':');
    if (colon > 0) out[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim();
    i = end + 1;
  }
  return out;
}

function selectors(prelude) {
  const list = [];
  let i = 0;
  while (i <= prelude.length) {
    let end = scan(prelude, i, ',');
    if (end < 0) end = prelude.length;
    list.push(prelude.slice(i, end).trim());
    i = end + 1;
  }
  return list.filter(Boolean);
}

/** Pour chaque sélecteur : affichage, direction et retour à la ligne déclarés n'importe où dans la feuille. */
function collectLayout(nodes, layout = {}) {
  for (const n of nodes) {
    if (n.children) collectLayout(n.children, layout);
    if (!n.decls) continue;
    for (const sel of selectors(n.prelude)) {
      const l = (layout[sel] = layout[sel] || {});
      if (n.decls.display) l.grid = l.grid || /grid/.test(n.decls.display);
      if (n.decls['grid-template-columns'] || n.decls['grid-template-rows'] || n.decls['grid-template-areas']) l.grid = true;
      if (n.decls['flex-direction']) l.column = /column/.test(n.decls['flex-direction']);
      if (n.decls['flex-wrap']) l.wrap = /^wrap/.test(n.decls['flex-wrap']);
    }
  }
  return layout;
}

function fallbackRules(node, layout) {
  const gap = node.decls.gap;
  if (!gap) return '';
  // "ligne colonne", les espaces entre parenthèses (calc…) ne séparent pas les valeurs.
  const parts = gap.split(/\s+(?![^(]*\))/);
  const rowGap = parts[0];
  const colGap = parts[1] || parts[0];
  let out = '';
  for (const sel of selectors(node.prelude)) {
    if (sel.indexOf('::') >= 0) continue;
    const l = layout[sel] || {};
    if (l.grid || /grid/.test(node.decls.display || '')) continue;
    const column = node.decls['flex-direction'] ? /column/.test(node.decls['flex-direction']) : !!l.column;
    const wrap = node.decls['flex-wrap'] ? /^wrap/.test(node.decls['flex-wrap']) : !!l.wrap;
    const scope = `.no-flex-gap ${sel}`;
    if (wrap) out += `${scope}>*{margin-right:${colGap};margin-bottom:${rowGap}}`;
    else if (column) out += `${scope}>*+*{margin-top:${rowGap}}`;
    else out += `${scope}>*+*{margin-left:${colGap}}`;
  }
  return out;
}

function print(nodes, layout) {
  let out = '';
  for (const n of nodes) {
    if (n.raw) out += n.raw;
    else if (n.children) out += `${n.prelude}{${print(n.children, layout)}}`;
    else out += `${n.prelude}{${n.body}}` + fallbackRules(n, layout);
  }
  return out;
}
