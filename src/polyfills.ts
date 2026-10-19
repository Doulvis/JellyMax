// Compléments pour les navigateurs des TV Samsung 2020-2021 (Chromium 69 / 76).
// La syntaxe moderne est déjà transpilée au build ; ici seulement quelques fonctions intégrées.
/* eslint-disable @typescript-eslint/no-explicit-any */

const g: any = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window;
if (!g.globalThis) g.globalThis = g;

if (!(Object as any).fromEntries) {
  (Object as any).fromEntries = (entries: Iterable<[PropertyKey, unknown]>) => {
    const o: any = {};
    for (const [k, v] of entries) o[k] = v;
    return o;
  };
}

if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (this: string, search: string | RegExp, replacement: any) {
    if (search instanceof RegExp) return this.replace(search, replacement);
    return this.split(search).join(replacement);
  };
}

if (!(Array.prototype as any).at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function (this: unknown[], n: number) {
      const i = Math.trunc(n) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}

if (!(Promise as any).allSettled) {
  (Promise as any).allSettled = (list: Iterable<unknown>) =>
    Promise.all(
      Array.from(list, (p) =>
        Promise.resolve(p).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      ),
    );
}

if (!g.queueMicrotask) {
  g.queueMicrotask = (cb: () => void) => {
    Promise.resolve()
      .then(cb)
      .catch((e) => setTimeout(() => { throw e; }));
  };
}

if (!(Object as any).hasOwn) {
  (Object as any).hasOwn = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
}

export {};
