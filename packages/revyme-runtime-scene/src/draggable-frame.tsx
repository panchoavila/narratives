'use client';
import { motion, useMotionValue, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';

export interface DraggableFrameProps extends Omit<HTMLMotionProps<'div'>, 'drag' | 'dragConstraints' | 'dragMomentum' | 'dragSnapToOrigin' | 'children'> {
  children?: ReactNode;
  axis?: 'both' | 'x' | 'y'; enabled?: boolean; momentum?: boolean; snapBack?: boolean;
  constrained?: boolean; minX?: number; maxX?: number; minY?: number; maxY?: number;
  moveLabel?: string; static?: boolean;
}
const finite = (n: number, fallback: number) => Number.isFinite(n) ? Math.max(-10000, Math.min(10000, n)) : fallback;
/** A gesture layer around editable children; local movement never changes their layout or rotation. */
export function RevymeDraggableFrame({ children, axis = 'both', enabled = true, momentum = false, snapBack = false, constrained = false,
  minX = -200, maxX = 200, minY = -200, maxY = 200, moveLabel = 'Move item with arrow keys', static: isStatic = false,
  style, onKeyDown, onKeyUp, ...props }: DraggableFrameProps) {
 const x = useMotionValue(0), y = useMotionValue(0), reduced = useReducedMotion();
 const left = Math.min(finite(minX, -200), finite(maxX, 200)), right = Math.max(finite(minX, -200), finite(maxX, 200));
 const top = Math.min(finite(minY, -200), finite(maxY, 200)), bottom = Math.max(finite(minY, -200), finite(maxY, 200));
 // Re-entering the static editor must restore the authored position.
 useEffect(() => { if (isStatic) { x.stop(); y.stop(); x.set(0); y.set(0); } }, [isStatic, x, y]);
 const draggable = enabled && !isStatic;
 const clamp = (value: number, min: number, max: number) => constrained ? Math.min(max, Math.max(min, value)) : value;
 return <motion.div {...props} data-revyme-draggable="" role={draggable ? 'group' : undefined} aria-label={draggable ? moveLabel : undefined}
  tabIndex={draggable ? 0 : undefined} drag={draggable ? axis === 'both' ? true : axis : false}
  dragConstraints={constrained ? {left,right,top,bottom} : undefined} dragMomentum={momentum && !reduced} dragSnapToOrigin={snapBack}
  onKeyDown={event => { onKeyDown?.(event); if (!draggable || event.defaultPrevented || event.target !== event.currentTarget) return; const step = event.shiftKey ? 1 : 10;
   if (axis !== 'y' && event.key === 'ArrowLeft') x.set(clamp(x.get() - step, left, right));
   else if (axis !== 'y' && event.key === 'ArrowRight') x.set(clamp(x.get() + step, left, right));
   else if (axis !== 'x' && event.key === 'ArrowUp') y.set(clamp(y.get() - step, top, bottom));
   else if (axis !== 'x' && event.key === 'ArrowDown') y.set(clamp(y.get() + step, top, bottom));
   else return; event.preventDefault(); }}
  onKeyUp={event => { onKeyUp?.(event); if (draggable && snapBack && event.target === event.currentTarget && event.key.startsWith('Arrow')) { x.set(0); y.set(0); } }}
  style={{ position:'relative', width:'100%', touchAction:draggable ? 'none' : undefined, cursor:draggable ? 'grab' : undefined, ...style, x, y }}>{children}</motion.div>;
}
