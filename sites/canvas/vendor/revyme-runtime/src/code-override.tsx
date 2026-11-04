'use client';

/**
 * Code overrides — HOCs applied to a single canvas element.
 *
 * An override file (`overrides/<Name>.tsx` in a Revyme project) exports
 * functions shaped `withX(Component) => Component`. A page applies one by
 * wrapping the element:
 *
 *   <Override with={withMouseDistanceHeight}>
 *     <motion.div data-id="card-1" style={…} />
 *   </Override>
 *
 * `Override` adds no DOM: it swaps its only child's type for the wrapped
 * component and forwards the child's props, key and ref untouched. The element
 * keeps its own JSX, so every editor generator that reads or writes it keeps
 * working; the canvas treats `<Override>` as transparent and never runs it
 * (overrides only run in preview and on the live site).
 *
 * A plain tag is rendered as its `motion.*` twin, so motion props apply.
 *
 * Also accepted, for override code imported from another editor:
 *   - a list: `with={[withA, withB]}` (applied left to right, innermost first)
 *   - legacy prop overrides: `function X(props) { return { animate: … } }`
 *   - a `text` prop on text layers (becomes the element's children)
 */

import React, {
  createElement,
  forwardRef,
  useEffect,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any> | string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeOverride = (Component: any) => any;

export interface OverrideProps {
  with?: CodeOverride | null | undefined | Array<CodeOverride | null | undefined>;
  children: ReactNode;
}

function isComponentLike(value: unknown): boolean {
  if (typeof value === 'function' || typeof value === 'string') return true;
  return !!value && typeof value === 'object' && '$$typeof' in (value as object);
}

/**
 * Innermost layer: some editors' text layers accept a `text` prop that plain
 * elements don't. Map it to children so a `withX` returning
 * `<Component text="…"/>` renders the text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseCache = new Map<AnyComponent, ComponentType<any>>();
function hostCompatible(type: AnyComponent): ComponentType<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let cached = baseCache.get(type);
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Overrides freely pass motion values in `style` and props like
    // `animate` / `whileHover`. A plain tag (`<div>`) would stringify those,
    // so it renders as its motion twin.
    const rendered = typeof type === 'string'
      ? ((motion as unknown as Record<string, AnyComponent>)[type] ?? type)
      : type;
    const Base = forwardRef<unknown, any>(({ text, ...props }, ref) =>
      createElement(rendered, { ...props, ref, ...(text != null ? { children: text } : {}) }),
    );
    Base.displayName = typeof type === 'string' ? type : `Overridable(${type.displayName || type.name || 'Component'})`;
    cached = Base;
    baseCache.set(type, cached);
  }
  return cached;
}

/** One override applied to one component type. Cached so identity is stable across renders. */
const applied = new WeakMap<CodeOverride, Map<unknown, ComponentType<unknown>>>();
function applyOne(fn: CodeOverride, Component: ComponentType<unknown>): ComponentType<unknown> {
  let byType = applied.get(fn);
  if (!byType) { byType = new Map(); applied.set(fn, byType); }
  const hit = byType.get(Component);
  if (hit) return hit;
  let result: ComponentType<unknown>;
  // HOCs take one argument; legacy prop overrides take props (or nothing) and
  // return a plain object. Probe the HOC form first, fall back on a non-component.
  let probe: unknown;
  try { probe = fn.length <= 1 ? fn(Component) : undefined; } catch { probe = undefined; }
  if (isComponentLike(probe)) {
    result = probe as ComponentType<unknown>;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Legacy = forwardRef<unknown, any>((props, ref) => {
      const extra = fn(props);
      return createElement(Component, { ...props, ...(extra && typeof extra === 'object' ? extra : {}), ref });
    });
    Legacy.displayName = `LegacyOverride(${fn.name || 'override'})`;
    result = Legacy as unknown as ComponentType<unknown>;
  }
  byType.set(Component, result);
  return result;
}

export function Override({ with: fns, children }: OverrideProps): ReactElement | null {
  const child = React.Children.only(children) as ReactElement<Record<string, unknown>>;
  const list = (Array.isArray(fns) ? fns : [fns]).filter((f): f is CodeOverride => typeof f === 'function');
  if (list.length === 0) return child;
  let Wrapped = hostCompatible(child.type as AnyComponent) as ComponentType<unknown>;
  for (const fn of list) Wrapped = applyOne(fn, Wrapped);
  // React 19 moved `ref` into props; React 18 keeps it on the element.
  const legacyRef = (child as unknown as { ref?: unknown }).ref;
  const props = { ...child.props } as Record<string, unknown>;
  if (props.ref === undefined && legacyRef != null) props.ref = legacyRef;
  return createElement(Wrapped as ComponentType<Record<string, unknown>>, { ...props, key: child.key ?? undefined });
}

/**
 * The shared override store: one module-level state object; every component
 * using the returned hook re-renders when any of them sets it. Lets two
 * overrides on different elements talk to each other.
 */
export function createStore<T>(initial: T): () => [T, (next: Partial<T> | ((prev: T) => Partial<T> | T)) => void] {
  let state: T = typeof initial === 'object' && initial !== null ? Object.freeze({ ...initial }) as T : initial;
  const setters = new Set<(value: T) => void>();
  const set = (next: Partial<T> | ((prev: T) => Partial<T> | T)) => {
    const value = typeof next === 'function' ? (next as (prev: T) => Partial<T> | T)(state) : next;
    state = typeof value === 'object' && value !== null
      ? Object.freeze({ ...(state as object), ...(value as object) }) as T
      : value as T;
    setters.forEach((setter) => setter(state));
  };
  return function useStore() {
    const [value, setValue] = useState(state);
    useEffect(() => {
      setters.add(setValue);
      // A set between render and effect would be missed otherwise.
      if (value !== state) setValue(state);
      return () => { setters.delete(setValue); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return [value, set];
  };
}

/**
 * Stand-ins for the host-editor APIs that imported override code reaches for
 * (render target, a data store, locale and router helpers). An import rewrites
 * `import { RenderTarget } from "<host>"` to `const { RenderTarget } =
 * hostCompat;`. Overrides never run on the editor canvas, so everything here
 * reports "preview / live".
 */
export const hostCompat = {
  RenderTarget: {
    canvas: 'CANVAS',
    export: 'EXPORT',
    thumbnail: 'THUMBNAIL',
    preview: 'PREVIEW',
    current: () => 'PREVIEW',
    hasRestrictions: () => false,
  },
  useIsOnCanvas: () => false,
  useIsStaticRenderer: () => false,
  isStaticRenderer: () => false,
  /** A host `Data` observable — a plain object is enough here. */
  Data: <T extends object>(value: T): T => value,
  useObserveData: () => false,
  useLocaleInfo: () => ({ activeLocale: null, locales: [], setLocale: () => {} }),
  useRouter: () => ({
    navigate: (path: string) => { if (typeof window !== 'undefined') window.location.assign(path); },
  }),
  addPropertyControls: () => {},
  ControlType: new Proxy({}, { get: (_, key) => String(key) }) as Record<string, string>,
  withCSS: <C,>(Component: C): C => Component,
};
