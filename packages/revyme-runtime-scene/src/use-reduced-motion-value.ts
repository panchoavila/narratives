'use client';
import { useEffect, useState } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
/** Preserve the source and other spatial transforms while resting this animated channel under reduced motion. */
export function useReducedMotionValue<T extends number | string>(source: MotionValue<T>, fallback: T, _authored = false): MotionValue<T> {
  const [reduced, setReduced] = useState(false);
  const value = useMotionValue(source.get());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update(); query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    value.set(reduced ? fallback : source.get());
    if (reduced) return;
    return source.on('change', next => value.set(next));
  }, [source, fallback, reduced, value]);
  return value;
}
