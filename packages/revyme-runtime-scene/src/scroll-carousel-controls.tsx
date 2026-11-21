'use client';
import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';

export interface ScrollCarouselControlsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'color'> {
  targetId?: string;
  labels?: string;
  size?: number;
  gap?: number;
  color?: string;
  activeColor?: string;
  static?: boolean;
}

/** Controls an editable native scroll container; no copy of the slides is made. */
export function RevymeScrollCarouselControls({ targetId = '', labels = '', size = 6, gap = 8, color = '#008800', activeColor = '#00ff00', static: isStatic = false, style, ...rest }: ScrollCarouselControlsProps) {
  const root = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(0);
  const names = labels.split('\n');
  useEffect(() => {
    const host = root.current;
    if (!host || !targetId) return;
    let scope: HTMLElement | null = host.parentElement;
    let found: HTMLElement | null = null;
    while (scope && !found) {
      found = Array.from(scope.querySelectorAll<HTMLElement>('[data-id]')).find(el => {
        const id = el.getAttribute('data-id');
        return id === targetId || !!id?.endsWith(':' + targetId);
      }) ?? null;
      scope = scope.parentElement;
    }
    if (!found) return;
    target.current = found;
    const container = found;
    const update = () => {
      const children = Array.from(container.children) as HTMLElement[];
      setCount(children.length);
      if (!children.length) { setActive(0); return; }
      const start = children[0].offsetLeft;
      const x = container.scrollLeft;
      let index = 0, distance = Infinity;
      children.forEach((child, i) => { const d = Math.abs(child.offsetLeft - start - x); if (d < distance) { index = i; distance = d; } });
      setActive(index);
    };
    container.addEventListener('scroll', update, { passive: true });
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(update);
    observer?.observe(container, { childList: true });
    update();
    return () => { container.removeEventListener('scroll', update); observer?.disconnect(); target.current = null; };
  }, [targetId]);
  const select = (index: number) => {
    const container = target.current;
    if (!container || isStatic) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (!children[index] || !children[0]) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left: children[index].offsetLeft - children[0].offsetLeft, behavior: reduced ? 'instant' : 'smooth' });
  };
  const dotSize = Math.max(1, Number(size) || 6);
  const dotStyle: CSSProperties = { width: dotSize, height: dotSize, padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', flex: '0 0 auto' };
  return <div ref={root} {...rest} role="group" aria-label="Navegación de iniciativas" style={{ display: 'flex', justifyContent: 'center', gap: Math.max(0, Number(gap) || 0), ...style }}>
    {Array.from({ length: count }, (_, index) => <button key={index} type="button" aria-label={names[index]?.trim() || `Ir a elemento ${index + 1}`} aria-current={active === index ? 'true' : undefined} onClick={() => select(index)} style={{ ...dotStyle, backgroundColor: active === index ? activeColor : color }} />)}
  </div>;
}
