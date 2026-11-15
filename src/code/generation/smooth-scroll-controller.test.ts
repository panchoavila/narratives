// @vitest-environment jsdom
/**
 * smooth-scroll-controller.test.ts — behaviour of the generated Smooth Scroll
 * controller. The test compiles the REAL SMOOTH_SCROLL_CONTROLLER_SOURCE string
 * (TypeScript → CommonJS), evaluates it with a require shim, and mounts
 * <SmoothScroll /> with react-dom. Lenis, next/navigation, the data module and
 * matchMedia are fakes the test controls; jsdom does no layout, so the page
 * and element dimensions are stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as ts from 'typescript';
import { parse } from '@babel/parser';
import {
  createDefaultSmoothScroll, normalizeSmoothScroll, parseSmoothScroll, serializeSmoothScroll,
  type SmoothScrollConfig, type SmoothScrollMap,
} from '@/code/project/smooth-scroll-config';
import { SMOOTH_SCROLL_CONTROLLER_SOURCE, SMOOTH_SCROLL_MARKER } from './smooth-scroll-gen';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REDUCED = '(prefers-reduced-motion: reduce)';
const gateQuery = (px: number) => `(min-width: ${px}px)`;

/** Lenis stub: records its constructor options, scrollTo and destroy. */
const lenisLog: StubLenis[] = [];
class StubLenis {
  readonly options: Record<string, unknown>;
  readonly scrollTo = vi.fn();
  readonly destroy = vi.fn();
  constructor(options: Record<string, unknown>) {
    this.options = options;
    lenisLog.push(this);
  }
}
/** Lenis instances that have not been destroyed. */
const liveLenis = () => lenisLog.filter((l) => l.destroy.mock.calls.length === 0);

/** A matchMedia list whose `matches` the test sets and whose `change` it fires. */
class FakeMediaList {
  readonly listeners = new Set<(e: unknown) => void>();
  matches = false;
  constructor(readonly media: string) {}
  addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'change') this.listeners.add(fn); }
  removeEventListener(type: string, fn: (e: unknown) => void) { if (type === 'change') this.listeners.delete(fn); }
  change(matches: boolean) {
    this.matches = matches;
    for (const fn of [...this.listeners]) fn({ matches, media: this.media });
  }
}
const mediaLists = new Map<string, FakeMediaList>();
const media = (q: string): FakeMediaList => {
  let m = mediaLists.get(q);
  if (!m) { m = new FakeMediaList(q); mediaLists.set(q, m); }
  return m;
};

/** Dimensions jsdom never computes, stubbed on the root element. */
const DIM_KEYS = ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight'] as const;
function setPage(p: { sw: number; cw: number; sh: number; ch: number }) {
  const vals = { scrollWidth: p.sw, clientWidth: p.cw, scrollHeight: p.sh, clientHeight: p.ch };
  for (const k of DIM_KEYS) {
    Object.defineProperty(document.documentElement, k, { configurable: true, get: () => vals[k] });
  }
}
const HORIZONTAL_PAGE = { sw: 3000, cw: 1000, sh: 800, ch: 800 };
const VERTICAL_PAGE = { sw: 1000, cw: 1000, sh: 3000, ch: 800 };
const MAX_X = HORIZONTAL_PAGE.sw - HORIZONTAL_PAGE.cw;

/** The compiled controller is run against these objects; the test mutates them. */
const routes = { path: '/' };
const smoothData: { SMOOTH_SCROLL: SmoothScrollMap } = { SMOOTH_SCROLL: { pages: {} } };

function compileController(): string {
  const out = ts.transpileModule(SMOOTH_SCROLL_CONTROLLER_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: 'smooth-scroll-controller.tsx',
    reportDiagnostics: true,
  });
  if (out.diagnostics?.length) {
    throw new Error(`controller does not compile: ${out.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
  }
  return out.outputText;
}

interface ControllerModule { SmoothScroll: () => null }

function loadController(): ControllerModule {
  const compiled = compileController();
  const mod = { exports: {} as Record<string, unknown> };
  const deps: Record<string, unknown> = {
    react: React,
    'next/navigation': { usePathname: () => routes.path },
    lenis: StubLenis,
    './smooth-scroll': smoothData,
  };
  const req = (name: string) => {
    if (!(name in deps)) throw new Error(`controller required an unmapped module: ${name}`);
    return deps[name];
  };
  new Function('require', 'module', 'exports', compiled)(req, mod, mod.exports);
  return mod.exports as unknown as ControllerModule;
}

let ctl: ControllerModule;
let container: HTMLDivElement;
let root: Root | null = null;

function render() {
  act(() => { root!.render(React.createElement(ctl.SmoothScroll)); });
}

/** Mount the controller with one page config (or none) at `path`. */
function boot(cfg: SmoothScrollConfig | null, path = '/') {
  smoothData.SMOOTH_SCROLL = { pages: cfg ? { '/': cfg } : {} };
  routes.path = path;
  render();
}

function unmount() {
  if (!root) return;
  act(() => { root!.unmount(); });
  root = null;
}

const cfg = (over: Partial<SmoothScrollConfig> = {}): SmoothScrollConfig => ({ ...createDefaultSmoothScroll(), ...over });
const horizontal = (over: Partial<SmoothScrollConfig> = {}) => cfg({ orientation: 'horizontal', ...over });

interface WheelInit {
  deltaY?: number; deltaX?: number; deltaMode?: number;
  ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
  target?: EventTarget;
}
function wheel(init: WheelInit): Event {
  const ev = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    deltaX: { value: init.deltaX ?? 0 },
    deltaY: { value: init.deltaY ?? 0 },
    deltaMode: { value: init.deltaMode ?? 0 },
    ctrlKey: { value: !!init.ctrlKey },
    metaKey: { value: !!init.metaKey },
    shiftKey: { value: !!init.shiftKey },
  });
  (init.target ?? document).dispatchEvent(ev);
  return ev;
}

interface KeyInit { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
function key(k: string, init: KeyInit = {}, target: EventTarget = document): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

const scrollBy = () => window.scrollBy as unknown as ReturnType<typeof vi.fn>;
const scrollTo = () => window.scrollTo as unknown as ReturnType<typeof vi.fn>;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  lenisLog.length = 0;
  mediaLists.clear();
  routes.path = '/';
  smoothData.SMOOTH_SCROLL = { pages: {} };
  setPage(HORIZONTAL_PAGE);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (q: string) => media(q) });
  window.scrollBy = vi.fn() as any;
  window.scrollTo = vi.fn() as any;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  ctl = loadController();
});

afterEach(() => {
  unmount();
  container.remove();
  for (const k of DIM_KEYS) delete (document.documentElement as any)[k];
  delete (window as any).matchMedia;
  document.head.querySelectorAll('style[data-revyme-lenis]').forEach((s) => s.remove());
  document.body.innerHTML = '';
  delete (window as any).__revymeLenis;
});

// ---------------------------------------------------------------------------
// H1 — reduced motion / smoothing off on a horizontal page: the unsmoothed remap
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: horizontal pages', () => {
  it('H1: reduced motion builds no Lenis and remaps the vertical wheel to X', () => {
    media(REDUCED).matches = true;
    boot(horizontal());
    expect(lenisLog).toHaveLength(0);
    const ev = wheel({ deltaY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledTimes(1);
    expect(scrollBy()).toHaveBeenCalledWith({ left: 100, top: 0, behavior: 'instant' });
  });

  it('H1b: smoothing switched off (enabled false) builds no Lenis and remaps the wheel', () => {
    boot(horizontal({ enabled: false }));
    expect(lenisLog).toHaveLength(0);
    const ev = wheel({ deltaY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledWith({ left: 100, top: 0, behavior: 'instant' });
  });

  it('H1c: smoothing on builds a horizontal Lenis and adds no wheel remap of its own', () => {
    boot(horizontal());
    expect(lenisLog).toHaveLength(1);
    expect(lenisLog[0].options.orientation).toBe('horizontal');
    expect(lenisLog[0].options.gestureOrientation).toBe('both');
    const ev = wheel({ deltaY: 100 });
    expect(ev.defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H2 — the width gate
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: width gate (horizontalFrom)', () => {
  it('H2: while (min-width: 1000px) does not match, the page is vertical (Lenis vertical, no remap)', () => {
    boot(horizontal({ horizontalFrom: 1000 }));
    expect(lenisLog).toHaveLength(1);
    expect(lenisLog[0].options.orientation).toBe('vertical');
    expect(lenisLog[0].options.gestureOrientation).toBe('vertical');
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(key(' ').defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H2: with smoothing off and the gate closed, neither wheel nor keys are remapped', () => {
    boot(horizontal({ enabled: false, horizontalFrom: 1000 }));
    expect(lenisLog).toHaveLength(0);
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H2b — a mis-configured page must not get a dead wheel
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: overflow guard', () => {
  it('H2b: no horizontal overflow means the unsmoothed wheel is not remapped', () => {
    setPage({ sw: 1000, cw: 1000, sh: 800, ch: 800 });
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H2b: vertical overflow means the unsmoothed wheel is not remapped', () => {
    setPage({ sw: 3000, cw: 1000, sh: 3000, ch: 800 });
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H3 / H5 — gestures that must not be remapped
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: wheel filtering', () => {
  it('H3: ctrl (pinch-zoom) and meta wheels are never remapped', () => {
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: 100, metaKey: true }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H5: a horizontal or diagonal gesture (|deltaX| >= |deltaY|) is not remapped', () => {
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaX: 100, deltaY: 10 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaX: 50, deltaY: 50 }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H5: a shift+wheel is not remapped (the browser already scrolls X)', () => {
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaY: 100, shiftKey: true }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H4: a wheel over a [data-lenis-prevent] ancestor is not remapped', () => {
    boot(horizontal({ enabled: false }));
    const guard = document.createElement('div');
    guard.setAttribute('data-lenis-prevent', '');
    const child = document.createElement('p');
    guard.appendChild(child);
    document.body.appendChild(guard);
    expect(wheel({ deltaY: 100, target: child }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H4: a wheel over an inner element that can still scroll vertically is not remapped, until it reaches the edge', () => {
    boot(horizontal({ enabled: false }));
    let top = 0;
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    const child = document.createElement('p');
    box.appendChild(child);
    document.body.appendChild(box);
    Object.defineProperties(box, {
      scrollHeight: { configurable: true, get: () => 500 },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: { configurable: true, get: () => top },
    });

    // At the top, scrolling down: the box can take the wheel.
    expect(wheel({ deltaY: 100, target: child }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();

    // Scrolled to the bottom, scrolling down: the box is at its edge, so the page takes it.
    top = 300;
    expect(wheel({ deltaY: 100, target: child }).defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledWith({ left: 100, top: 0, behavior: 'instant' });

    // Scrolling up from the bottom: the box can still scroll up, so it keeps the wheel.
    scrollBy().mockClear();
    expect(wheel({ deltaY: -100, target: child }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H6 — line and page delta modes
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: wheel delta modes', () => {
  it('H6: deltaMode lines: 3 lines are 60px', () => {
    boot(horizontal({ enabled: false }));
    wheel({ deltaY: 3, deltaMode: 1 });
    expect(scrollBy()).toHaveBeenCalledWith({ left: 60, top: 0, behavior: 'instant' });
  });

  it('H6: deltaMode pages: 1 page is clientWidth px', () => {
    boot(horizontal({ enabled: false }));
    wheel({ deltaY: 1, deltaMode: 2 });
    expect(scrollBy()).toHaveBeenCalledWith({ left: HORIZONTAL_PAGE.cw, top: 0, behavior: 'instant' });
  });
});

// ---------------------------------------------------------------------------
// H7 — keyboard on a horizontal page
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: keyboard on horizontal pages', () => {
  it('H7: Space and PageDown step +0.9 x clientWidth; Shift+Space and PageUp step back', () => {
    boot(horizontal({ enabled: false }));
    const space = key(' ');
    expect(space.defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 900, top: 0, behavior: 'instant' });
    key(' ', { shiftKey: true });
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: -900, top: 0, behavior: 'instant' });
    key('PageDown');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 900, top: 0, behavior: 'instant' });
    key('PageUp');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: -900, top: 0, behavior: 'instant' });
  });

  it('H7: ArrowDown and ArrowUp step +40 and -40', () => {
    boot(horizontal({ enabled: false }));
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 40, top: 0, behavior: 'instant' });
    key('ArrowUp');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: -40, top: 0, behavior: 'instant' });
  });

  it('H7: Home and End go to the start and to scrollWidth - clientWidth, keeping the scrollY', () => {
    boot(horizontal({ enabled: false }));
    key('Home');
    expect(scrollTo()).toHaveBeenLastCalledWith({ left: 0, top: window.scrollY, behavior: 'instant' });
    key('End');
    expect(scrollTo()).toHaveBeenLastCalledWith({ left: MAX_X, top: window.scrollY, behavior: 'instant' });
  });

  it('H7: reduced motion makes the key steps instant', () => {
    media(REDUCED).matches = true;
    boot(horizontal());
    key('ArrowDown');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 40, top: 0, behavior: 'instant' });
  });

  it('H7: with Lenis running, keys call lenis.scrollTo with a clamped absolute target', () => {
    boot(horizontal());
    const lenis = lenisLog[0];
    key(' ');
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(900);
    key('ArrowUp');                       // 0 - 40 clamps to 0
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(0);
    key('End');
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(MAX_X);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H7: an event already defaultPrevented by another listener is left alone', () => {
    boot(horizontal({ enabled: false }));
    const first = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', first);
    try {
      key('ArrowDown');
      expect(scrollBy()).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', first);
    }
  });

  it('H7: Alt, Ctrl and Meta chords are not handled, and Shift is only allowed for Space', () => {
    boot(horizontal({ enabled: false }));
    expect(key('ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('PageDown', { metaKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowDown', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(key('PageDown', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H7: keys typed into an input, textarea, select or contenteditable are not handled', () => {
    boot(horizontal({ enabled: false }));
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.append(input, textarea, select, editable);
    for (const el of [input, textarea, select, inner]) {
      expect(key(' ', {}, el).defaultPrevented).toBe(false);
      expect(key('ArrowDown', {}, el).defaultPrevented).toBe(false);
    }
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H7: Space on an interactive element is not handled', () => {
    boot(horizontal({ enabled: false }));
    const button = document.createElement('button');
    const roleButton = document.createElement('div');
    roleButton.setAttribute('role', 'button');
    const tab = document.createElement('div');
    tab.setAttribute('role', 'tab');
    document.body.append(button, roleButton, tab);
    for (const el of [button, roleButton, tab]) {
      expect(key(' ', {}, el).defaultPrevented).toBe(false);
    }
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H7: a vertical page leaves the keys alone', () => {
    setPage(VERTICAL_PAGE);
    boot(cfg({ enabled: false }));
    expect(key(' ').defaultPrevented).toBe(false);
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
    expect(scrollTo()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H8 — live switching without a remount
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: live gate and reduced-motion changes', () => {
  it('H8: flipping the width gate destroys the vertical Lenis and leaves exactly one horizontal instance', () => {
    boot(horizontal({ horizontalFrom: 1000 }));
    expect(lenisLog).toHaveLength(1);
    expect(lenisLog[0].options.orientation).toBe('vertical');

    act(() => { media(gateQuery(1000)).change(true); });

    expect(lenisLog).toHaveLength(2);
    expect(lenisLog[0].destroy).toHaveBeenCalledTimes(1);
    expect(liveLenis()).toHaveLength(1);
    expect(liveLenis()[0].options.orientation).toBe('horizontal');
    expect(media(gateQuery(1000)).listeners.size).toBe(1);
  });

  it('H8: flipping reduced motion on tears Lenis down and switches to the unsmoothed remap, once per event', () => {
    boot(horizontal());
    expect(liveLenis()).toHaveLength(1);

    act(() => { media(REDUCED).change(true); });

    expect(lenisLog[0].destroy).toHaveBeenCalledTimes(1);
    expect(liveLenis()).toHaveLength(0);
    expect(media(REDUCED).listeners.size).toBe(1);
    const ev = wheel({ deltaY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledTimes(1);
  });

  it('H8: flipping the gate back to closed restores the vertical page and stops the remap', () => {
    media(gateQuery(1000)).matches = true;
    boot(horizontal({ enabled: false, horizontalFrom: 1000 }));
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    act(() => { media(gateQuery(1000)).change(false); });
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrollBy()).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// H9 — teardown
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: teardown', () => {
  it('H9: unmounting removes the listeners, the matchMedia listeners and the injected style, and destroys Lenis', () => {
    boot(horizontal({ horizontalFrom: 1000 }));
    expect(liveLenis()).toHaveLength(1);
    expect(document.head.querySelector('style[data-revyme-lenis]')).not.toBeNull();
    expect(media(gateQuery(1000)).listeners.size).toBe(1);
    expect(media(REDUCED).listeners.size).toBe(1);

    unmount();

    expect(lenisLog[0].destroy).toHaveBeenCalledTimes(1);
    expect(media(gateQuery(1000)).listeners.size).toBe(0);
    expect(media(REDUCED).listeners.size).toBe(0);
    expect(document.head.querySelector('style[data-revyme-lenis]')).toBeNull();
    expect((window as any).__revymeLenis).toBeUndefined();
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();
  });

  it('H9: a route with no config tears everything down, and a return to a configured route rebuilds it', () => {
    boot(horizontal({ enabled: false }));
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    scrollBy().mockClear();

    routes.path = '/elsewhere';
    render();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrollBy()).not.toHaveBeenCalled();

    routes.path = '/';
    render();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// H10 — marker, source shape, and the config round trip for horizontalFrom
// ---------------------------------------------------------------------------

describe('Smooth Scroll codegen v3', () => {
  it('H10: the marker is v3 and appears in the controller source; the source parses as TSX', () => {
    expect(SMOOTH_SCROLL_MARKER).toBe('@smooth-scroll v3');
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain(SMOOTH_SCROLL_MARKER);
    expect(() => parse(SMOOTH_SCROLL_CONTROLLER_SOURCE, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });
});

describe('Smooth Scroll config: horizontalFrom', () => {
  it('rounds a finite width to an integer, and keeps 1 or more', () => {
    expect(normalizeSmoothScroll({ horizontalFrom: 999.6 }).horizontalFrom).toBe(1000);
    expect(normalizeSmoothScroll({ horizontalFrom: 1 }).horizontalFrom).toBe(1);
  });

  it('omits the key entirely for 0, negative, NaN, text and absent values', () => {
    for (const bad of [0, -5, NaN, 'abc', Infinity]) {
      const out = normalizeSmoothScroll({ horizontalFrom: bad as any });
      expect('horizontalFrom' in out).toBe(false);
    }
    expect('horizontalFrom' in normalizeSmoothScroll(undefined)).toBe(false);
    expect('horizontalFrom' in createDefaultSmoothScroll()).toBe(false);
  });

  it('round-trips through serialize and parse', () => {
    const map: SmoothScrollMap = { pages: { '/': horizontal({ horizontalFrom: 1200 }), '/about': horizontal() } };
    const parsed = parseSmoothScroll(serializeSmoothScroll(map));
    expect(parsed.pages['/'].horizontalFrom).toBe(1200);
    expect('horizontalFrom' in parsed.pages['/about']).toBe(false);
    expect(parsed).toEqual(map);
  });
});

// ---------------------------------------------------------------------------
// Page Flow — the page root says the page reads sideways (`--revyme-page-flow`)
// ---------------------------------------------------------------------------

/** The page root, carrying Page Flow's custom property the way a band sets it. */
function pageRoot(flow: 'horizontal' | 'vertical' | null): HTMLElement {
  let el = document.querySelector<HTMLElement>('[data-id="root"]');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-id', 'root');
    document.body.appendChild(el);
  }
  if (flow === null) el.style.removeProperty('--revyme-page-flow');
  else el.style.setProperty('--revyme-page-flow', flow);
  return el;
}

function resize() {
  act(() => { window.dispatchEvent(new Event('resize')); });
}

describe('Smooth Scroll controller: Page Flow pages', () => {
  it('PF1: a root that reads sideways, with no smooth-scroll entry, gets the wheel and keys on X (no Lenis)', () => {
    pageRoot('horizontal');
    boot(null);
    expect(lenisLog).toHaveLength(0);
    const ev = wheel({ deltaY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(scrollBy()).toHaveBeenCalledWith({ left: 100, top: 0, behavior: 'instant' });
    expect(key('PageDown').defaultPrevented).toBe(true);
  });

  it('PF2: with a vertical smooth-scroll entry, a root that reads sideways runs Lenis horizontally', () => {
    pageRoot('horizontal');
    boot(cfg());
    expect(liveLenis()).toHaveLength(1);
    expect(liveLenis()[0].options.orientation).toBe('horizontal');
    expect(liveLenis()[0].options.gestureOrientation).toBe('both');
  });

  it('PF3: a root without Page Flow and no entry: nothing is taken over', () => {
    pageRoot(null);
    boot(null);
    expect(lenisLog).toHaveLength(0);
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(key('PageDown').defaultPrevented).toBe(false);
  });

  it('PF4: crossing a breakpoint that changes the root (window resize) switches modes live, one Lenis at a time', () => {
    const root = pageRoot('vertical');
    boot(cfg());
    expect(liveLenis()).toHaveLength(1);
    expect(liveLenis()[0].options.orientation).toBe('vertical');
    root.style.setProperty('--revyme-page-flow', 'horizontal');
    resize();
    expect(liveLenis()).toHaveLength(1);
    expect(liveLenis()[0].options.orientation).toBe('horizontal');
    root.style.setProperty('--revyme-page-flow', 'vertical');
    resize();
    expect(liveLenis()).toHaveLength(1);
    expect(liveLenis()[0].options.orientation).toBe('vertical');
  });

  it('PF4b: a resize that does not change the mode does not rebuild Lenis', () => {
    pageRoot('horizontal');
    boot(cfg());
    const first = liveLenis()[0];
    resize();
    resize();
    expect(liveLenis()).toEqual([first]);
  });

  it('PF5: without an entry, a page that turns sideways at a breakpoint starts the remap, and stops it when it turns back', () => {
    const root = pageRoot('vertical');
    boot(null);
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    root.style.setProperty('--revyme-page-flow', 'horizontal');
    resize();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    root.style.setProperty('--revyme-page-flow', 'vertical');
    resize();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
  });

  it('PF6: unmounting removes the resize listener too', () => {
    const root = pageRoot('vertical');
    boot(cfg());
    unmount();
    const before = lenisLog.length;
    root.style.setProperty('--revyme-page-flow', 'horizontal');
    resize();
    expect(lenisLog.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// H11 — a classic horizontal scrollbar takes height from a full-height page
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: classic scrollbars (H11)', () => {
  /** A full-height horizontal page under a 15 px scrollbar: content 815 tall, 800 visible. */
  const UNDER_SCROLLBAR = { sw: 3000, cw: 1000, sh: 815, ch: 800 };
  const setInnerHeight = (h: number) => Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });

  afterEach(() => {
    document.documentElement.style.removeProperty('overflow-y');
    setInnerHeight(768);
  });

  it('H11a: overflow no larger than the scrollbar counts as none: the wheel still moves X and the sliver is hidden', () => {
    setPage(UNDER_SCROLLBAR);
    setInnerHeight(815);
    pageRoot('horizontal');
    boot(null);
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    expect(document.documentElement.style.overflowY).toBe('hidden');
  });

  it('H11b: a page that really overflows downwards is never clipped, and its wheel is not taken', () => {
    setPage({ sw: 3000, cw: 1000, sh: 3000, ch: 800 });
    setInnerHeight(815);
    pageRoot('horizontal');
    boot(null);
    expect(document.documentElement.style.overflowY).toBe('');
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
  });

  it('H11c: the hidden sliver is given back when the page turns vertical and when the controller unmounts', () => {
    setPage(UNDER_SCROLLBAR);
    setInnerHeight(815);
    const root = pageRoot('horizontal');
    boot(null);
    expect(document.documentElement.style.overflowY).toBe('hidden');
    root.style.setProperty('--revyme-page-flow', 'vertical');
    resize();
    expect(document.documentElement.style.overflowY).toBe('');
    root.style.setProperty('--revyme-page-flow', 'horizontal');
    resize();
    expect(document.documentElement.style.overflowY).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflowY).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Review 1 findings — Lenis dimensions, keys from Lenis's target, keys widgets own, the sliver
// re-checked after a flow lays out
// ---------------------------------------------------------------------------

describe('Smooth Scroll controller: review findings', () => {
  it('Lenis reads the page width live when sideways (the page widens without its box changing)', () => {
    boot(horizontal());
    expect(liveLenis()[0].options.naiveDimensions).toBe(true);
    unmount();
    root = createRoot(container);
    boot(cfg());
    expect(liveLenis()[0].options.naiveDimensions).toBe(false);
  });

  it('keys page from where Lenis is heading, not where the window is', () => {
    boot(horizontal());
    (liveLenis()[0] as unknown as { targetScroll: number }).targetScroll = 500;
    key('PageDown');
    expect(liveLenis()[0].scrollTo).toHaveBeenLastCalledWith(500 + 0.9 * HORIZONTAL_PAGE.cw);
  });

  it('widgets that own their keys, media and modal dialogs keep them', () => {
    boot(horizontal({ enabled: false }));
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.tabIndex = 0;
    document.body.appendChild(slider);
    expect(key('ArrowUp', {}, slider).defaultPrevented).toBe(false);
    const video = document.createElement('video');
    document.body.appendChild(video);
    expect(key(' ', {}, video).defaultPrevented).toBe(false);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const inside = document.createElement('div');
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    expect(key('PageDown', {}, inside).defaultPrevented).toBe(false);
  });

  it('Space on a focused link pages, as it scrolls natively', () => {
    boot(horizontal({ enabled: false }));
    const link = document.createElement('a');
    link.href = '#x';
    document.body.appendChild(link);
    expect(key(' ', {}, link).defaultPrevented).toBe(true);
  });

  it('with smoothing switched off, keys page without animation', () => {
    boot(horizontal({ enabled: false }));
    key('PageDown');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 0.9 * HORIZONTAL_PAGE.cw, top: 0, behavior: 'instant' });
  });

  it('the scrollbar sliver is checked again after a flow lays out, without a resize', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    setPage({ sw: 1000, cw: 1000, sh: 800, ch: 800 });
    pageRoot('horizontal');
    boot(null);
    expect(document.documentElement.style.overflowY).toBe('');
    // The flow lays out: the page widens and a 15 px scrollbar appears under it.
    setPage({ sw: 3000, cw: 1000, sh: 800, ch: 785 });
    act(() => { window.dispatchEvent(new CustomEvent('revyme:layout')); });
    expect(document.documentElement.style.overflowY).toBe('hidden');
    document.documentElement.style.removeProperty('overflow-y');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });
});

describe('Smooth Scroll controller: key animation on a Page Flow page without an entry', () => {
  it('pages smoothly when nothing asked for less motion, instantly under reduced motion', () => {
    pageRoot('horizontal');
    boot(null);
    key('PageDown');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 0.9 * HORIZONTAL_PAGE.cw, top: 0, behavior: 'smooth' });
    act(() => { media(REDUCED).change(true); });
    key('PageDown');
    expect(scrollBy()).toHaveBeenLastCalledWith({ left: 0.9 * HORIZONTAL_PAGE.cw, top: 0, behavior: 'instant' });
  });
});
