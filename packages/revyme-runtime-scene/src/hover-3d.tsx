'use client';
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from 'framer-motion';
import { useEffect, useRef, type HTMLAttributes, type PointerEvent } from 'react';

export interface Hover3DProps extends HTMLAttributes<HTMLDivElement> {
  angle?: number;
  directions?: 'all' | 'vertical' | 'horizontal';
  perspective?: number;
  transitionConfig?: string | Transition;
  static?: boolean;
}

/** Resolve pointer displacement in the host's local rectangle. */
export function hover3DAngles(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, angle: number, directions: Hover3DProps['directions']): [number, number] {
  if (!rect.width || !rect.height) return [0, 0];
  const amount = Number.isFinite(angle) ? Math.max(-45, Math.min(45, angle)) : 12;
  return [directions === 'all' || directions === 'vertical' ? -((clientY - rect.top - rect.height / 2) / rect.height) * amount * 2 : 0,
    directions === 'all' || directions === 'horizontal' ? ((clientX - rect.left - rect.width / 2) / rect.width) * amount * 2 : 0];
}

export function hover3DTransition(config?: Hover3DProps['transitionConfig']): Transition {
  const fallback: Transition = { type: 'spring', stiffness: 200, damping: 30, mass: 1 };
  try {
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const p = parsed as Record<string, unknown>;
    const number = (value: unknown, defaultValue: number) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
    if (p.type === 'instant') return { duration: 0 };
    if (p.type === 'spring' && p.stiffness != null) return { type: 'spring', stiffness: number(p.stiffness, 200), damping: number(p.damping, 30), mass: number(p.mass, 1), delay: number(p.delay, 0) };
    if (p.type === 'spring') return { type: 'spring', duration: number(p.duration, 0.5), bounce: number(p.bounce, 0.1), delay: number(p.delay, 0) };
    let ease = p.ease;
    if (typeof ease === 'string' && ease.startsWith('[')) { try { ease = JSON.parse(ease); } catch { ease = undefined; } }
    return { type: 'tween', duration: number(p.duration, 0.45), delay: number(p.delay, 0), ...(ease ? { ease } : {}) } as Transition;
  } catch { return fallback; }
}

/** A live, perspective-transformed surface. Its children keep their own layout and events. */
export function RevymeHover3D({ angle = 12, directions = 'all', perspective = 1000, transitionConfig, static: isStatic = false, children, style, onPointerEnter, onPointerLeave, onPointerMove, ...props }: Hover3DProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const influence = useMotionValue(0);
  const rotateX = useTransform([x, influence], values => Number(values[0]) * Number(values[1]));
  const rotateY = useTransform([y, influence], values => Number(values[0]) * Number(values[1]));
  const reducedMotion = useReducedMotion();
  const running = useRef<ReturnType<typeof animate> | null>(null);
  useEffect(() => () => { running.current?.stop(); }, []);
  useEffect(() => {
    if (isStatic || reducedMotion) { running.current?.stop(); influence.set(0); x.set(0); y.set(0); }
  }, [isStatic, reducedMotion, influence, x, y]);
  const transition = hover3DTransition(transitionConfig);
  const active = !isStatic && !reducedMotion;
  const setInfluence = (value: number) => { running.current?.stop(); running.current = animate(influence, value, transition); };
  const enter = (event: PointerEvent<HTMLDivElement>) => { onPointerEnter?.(event); if (active && event.pointerType !== 'touch') setInfluence(1); };
  const leave = (event: PointerEvent<HTMLDivElement>) => { onPointerLeave?.(event); if (active) setInfluence(0); };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    if (!active || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const [nextX, nextY] = hover3DAngles(event.clientX, event.clientY, rect, angle, directions);
    x.set(nextX);
    y.set(nextY);
  };
  return <div {...props} onPointerEnter={enter} onPointerLeave={leave} onPointerMove={move} style={{ perspective: `${Number.isFinite(perspective) ? Math.max(1, perspective) : 1000}px`, transformStyle: 'preserve-3d', ...style }}>
    <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d', width: '100%', height: '100%' }}>{children}</motion.div>
  </div>;
}
