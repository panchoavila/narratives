/**
 * Vitest setup — hand the jsdom environment the window's own Web Storage.
 *
 * Node 25+ defines `localStorage` on `globalThis` (an accessor that returns
 * `undefined` unless `--localstorage-file` is passed) and `sessionStorage`
 * (Node's own in-memory Storage). Vitest's jsdom environment only copies a
 * window property onto a global that already has it when the key is on its
 * fixed list, and neither storage is — so Node's globals shadowed jsdom's and
 * every test that touched `localStorage` read `undefined`.
 *
 * This points both globals back at the jsdom window's Storage objects, with the
 * same accessor shape Vitest gives every other window key (a setter records an
 * override, so assignment and `vi.stubGlobal` keep working), and puts Node's
 * descriptors back when the file finishes. Files running in the `node`
 * environment have no `globalThis.jsdom` and are left untouched.
 */
import { afterAll } from 'vitest';

type StorageKey = 'localStorage' | 'sessionStorage';

const STORAGE_KEYS: readonly StorageKey[] = ['localStorage', 'sessionStorage'];

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;

if (dom) {
  for (const key of STORAGE_KEYS) {
    // Captured once, not read through `globalThis[key]`: when the global IS the
    // window (vm pools) that read would call this accessor again.
    const storage = dom.window[key];
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    let override: { value: unknown } | undefined;

    Object.defineProperty(globalThis, key, {
      get: () => (override ? override.value : storage),
      set: (value: unknown) => {
        override = { value };
      },
      configurable: true,
    });

    afterAll(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}
