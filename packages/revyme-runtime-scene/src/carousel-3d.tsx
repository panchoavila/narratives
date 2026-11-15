'use client';

import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import { DEFAULT_CAROUSEL_3D, normalizeCarousel3D, type Carousel3DConfig } from './carousel-3d-config';
import { carousel3DFit, carousel3DGeometry } from './carousel-3d-geometry';

export interface Carousel3DProps extends Partial<Carousel3DConfig>, Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode;
  static?: boolean;
}

const rotation = (x: number, y: number, z: number) => `rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
// The canvas bridge serializes numeric JSX style lengths as strings.
const dimension = (value: CSSProperties['width']) =>
  typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value ?? '100%';
const arrowStyle: CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', border: '1px solid currentColor',
  color: 'inherit', background: 'transparent', cursor: 'pointer', fontSize: 22,
};

/** Live DOM planes on one shared 3D layout. The slot owns spatial transforms. */
export function RevymeCarousel3D(props: Carousel3DProps) {
  const { children, static: isStatic = false, style, className, id } = props;
  const config = normalizeCarousel3D(props);
  const attributes = { ...props } as Record<string, unknown>;
  for (const key of [...Object.keys(DEFAULT_CAROUSEL_3D), 'children', 'static', 'style']) delete attributes[key];
  const signature = JSON.stringify(config);
  const connected = Children.toArray(children);
  let hasCollection = false;
  const items = connected.flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; 'data-revyme-collection-slot'?: string }>(child) ||
        child.props['data-revyme-collection-slot'] === undefined) return [child];
    hasCollection = true;
    return Children.toArray(child.props.children).map((item, index) =>
      isValidElement<{ style?: CSSProperties }>(item) ? cloneElement(item, {
        key: String(child.key) + '/' + String(item.key ?? index),
        style: { ...item.props.style, position: 'relative', left: 'auto', right: 'auto',
          top: 'auto', bottom: 'auto', margin: 0, width: '100%', height: '100%' },
      }) : item);
  });
  const keys = items.map((item, index) => typeof item === 'object' && 'key' in item ? item.key : index).join('|');
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const navigate = useRef<(direction: number, instant?: boolean) => void>(() => {});
  const phase = useMotionValue(config.phase);
  const tiltX = useMotionValue(config.rotateX);
  const tiltY = useMotionValue(config.rotateY);
  const tiltZ = useMotionValue(config.rotateZ);

  useLayoutEffect(() => {
    const host = root.current!, stage = scene.current;
    if (!stage || !items.length) return;
    const settings = JSON.parse(signature) as Carousel3DConfig;
    const slots = Array.from(stage.children) as HTMLElement[];
    const win = host.ownerDocument.defaultView!;
    const doc = host.ownerDocument;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, lastTime = 0, visible = true, hovered = false, focused = false;
    let drag: { id: number; x: number; y: number; phase: number; rx: number; ry: number; moved: boolean } | null = null;
    let suppressClick = false;
    let size = { width: host.clientWidth, height: host.clientHeight };
    let scale = carousel3DFit(settings, slots.length, size.width, size.height);
    let navigationAnimation: ReturnType<typeof animate> | undefined;

    function paint() {
      const pose = { x: tiltX.get(), y: tiltY.get(), z: tiltZ.get() };
      stage!.style.transform = `scale3d(${scale},${scale},${scale}) translate3d(${settings.offsetX}px,${settings.offsetY}px,${settings.offsetZ}px) ${rotation(pose.x, pose.y, pose.z)}`;
      const geometry = carousel3DGeometry(settings, slots.length, phase.get(), pose);
      slots.forEach((slot, index) => {
        const item = geometry[index];
        const cx = (item.center.x + settings.offsetX) * scale;
        const cy = (item.center.y + settings.offsetY) * scale;
        const cz = (item.center.z + settings.offsetZ) * scale;
        const facing = settings.perspective > 0
          ? -item.normal.x * cx - item.normal.y * cy + item.normal.z * (settings.perspective - cz)
          : item.normal.z;
        const shown = (settings.backfaces || facing > 0.001) &&
          (!settings.perspective || cz < settings.perspective - 1);
        slot.style.transform = item.transform;
        slot.style.opacity = String(item.opacity);
        slot.style.visibility = shown ? 'visible' : 'hidden';
        slot.inert = !shown;
        slot.setAttribute('aria-hidden', String(!shown));
      });
    }

    function tick(now: number) {
      frame = 0;
      if (lastTime) phase.set(phase.get() + settings.speed * Math.min((now - lastTime) / 1000, 0.064));
      lastTime = now;
      frame = win.requestAnimationFrame(tick);
    }
    function schedule() {
      win.cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (!isStatic && !reduced.matches && settings.autoplay && settings.speed && visible &&
          !doc.hidden && !focused && !drag && !(settings.pauseOnHover && hovered)) {
        frame = win.requestAnimationFrame(tick);
      }
    }
    const stopNavigation = () => { navigationAnimation?.stop(); navigationAnimation = undefined; };
    navigate.current = (direction, instant = false) => {
      stopNavigation();
      const step = (settings.layout === 'line' ? 360 : settings.arc) / Math.max(1, Math.ceil(slots.length / settings.rows));
      const next = phase.get() + direction * step;
      if (instant || reduced.matches || isStatic) phase.set(next);
      else navigationAnimation = animate(phase, next, { type: 'spring', visualDuration: 0.28, bounce: 0 });
    };
    const controls = [phase, tiltX, tiltY, tiltZ];
    const stops = controls.map(value => value.on('change', paint));
    const targets = [settings.phase, settings.rotateX, settings.rotateY, settings.rotateZ];
    const transitions = controls.map((value, index) => {
      if (isStatic || reduced.matches || (index === 0 && settings.autoplay)) { value.jump(targets[index]); return undefined; }
      return animate(value, targets[index], { type: 'spring', visualDuration: 0.28, bounce: 0 });
    });

    function down(event: PointerEvent) {
      if (isStatic || settings.dragMode === 'none' || event.button !== 0 ||
          (event.target as Element).closest('input,textarea,select,[contenteditable="true"],[data-carousel-navigation]')) return;
      stopNavigation();
      transitions.forEach(control => control?.stop());
      suppressClick = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        phase: phase.get(), rx: tiltX.get(), ry: tiltY.get(), moved: false };
      schedule();
    }
    function move(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      host.setPointerCapture(event.pointerId);
      const degrees = 180 / Math.max(200, size.width);
      if (settings.dragMode === 'orbit') {
        tiltY.set(drag.ry + dx * degrees);
        tiltX.set(Math.max(-180, Math.min(180, drag.rx - dy * degrees)));
      } else phase.set(drag.phase + dx * degrees);
    }
    function up(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return;
      suppressClick = drag.moved;
      drag = null;
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      schedule();
    }
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    };
    const enter = () => { hovered = true; schedule(); };
    const leave = () => { hovered = false; schedule(); };
    const focus = () => { focused = true; schedule(); };
    const blur = (event: FocusEvent) => { if (!host.contains(event.relatedTarget as Node)) { focused = false; schedule(); } };
    const keyboard = (event: KeyboardEvent) => {
      if (event.target !== host || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') { stopNavigation(); phase.set(settings.phase); }
      else navigate.current(event.key === 'ArrowRight' ? 1 : -1, true);
    };
    const resize = new ResizeObserver(() => {
      size = { width: host.clientWidth, height: host.clientHeight };
      scale = carousel3DFit(settings, slots.length, size.width, size.height);
      paint();
    });
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      schedule();
    });
    const preferenceChanged = () => {
      if (reduced.matches) {
        stopNavigation();
        transitions.forEach(control => control?.stop());
      }
      schedule();
    };
    resize.observe(host);
    intersection.observe(host);
    const listeners: [string, EventListener, boolean?][] = [
      ['pointerdown', down as EventListener], ['pointermove', move as EventListener],
      ['pointerup', up as EventListener], ['pointercancel', up as EventListener],
      ['lostpointercapture', up as EventListener], ['click', click as EventListener, true],
      ['pointerenter', enter], ['pointerleave', leave], ['focusin', focus],
      ['focusout', blur as EventListener], ['keydown', keyboard as EventListener],
      ['dragstart', event => { if (settings.dragMode !== 'none') event.preventDefault(); }],
    ];
    for (const [event, listener, capture] of listeners) host.addEventListener(event, listener, capture);
    doc.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', preferenceChanged);
    paint();
    schedule();
    return () => {
      win.cancelAnimationFrame(frame);
      stopNavigation();
      transitions.forEach(control => control?.stop());
      stops.forEach(stop => stop());
      resize.disconnect();
      intersection.disconnect();
      doc.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', preferenceChanged);
      for (const [event, listener, capture] of listeners) host.removeEventListener(event, listener, capture);
      navigate.current = () => {};
    };
  }, [signature, keys, items.length, isStatic, phase, tiltX, tiltY, tiltZ]);

  const initial = carousel3DGeometry(config, items.length);
  return <div {...attributes} ref={root} id={id} className={className}
    data-revyme-carousel-3d="" data-revyme-spatial-root="" data-static={isStatic || undefined}
    role="region" aria-roledescription="carousel" aria-label={props['aria-label'] || '3D Carousel'}
    tabIndex={isStatic ? -1 : 0}
    style={{ position: 'relative', ...style, width: dimension(style?.width), height: dimension(style?.height) }}>
    <div data-revyme-spatial-camera="" style={{ position: 'absolute', inset: 0, overflow: 'clip',
      perspective: config.perspective > 0 ? config.perspective : undefined,
      touchAction: config.dragMode === 'orbit' ? 'none' : 'pan-y' }}>
      <div ref={scene} style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0,
        transformOrigin: '0 0', transformStyle: 'preserve-3d',
        transform: rotation(config.rotateX, config.rotateY, config.rotateZ) }}>
        {items.map((child, index) => <div key={typeof child === 'object' && 'key' in child ? child.key : index}
          data-revyme-carousel-slot="" data-revyme-spatial-surface="" role="group" aria-roledescription="slide" aria-label={`${index + 1} / ${items.length}`}
          style={{ position: 'absolute', left: 0, top: 0, width: config.itemWidth, height: config.itemHeight,
            transformOrigin: '0 0', transform: initial[index].transform,
            backfaceVisibility: config.backfaces ? 'visible' : 'hidden', display: 'grid' }}>
          {child}
        </div>)}
      </div>
    </div>
    {!items.length && <div style={{ display: 'grid', placeContent: 'center', height: '100%', textAlign: 'center',
      border: '1px dashed currentColor', borderRadius: 12, gap: 8 }}>
      <strong>3D Carousel</strong><span>{hasCollection ? 'No items in this collection' : 'Connect content as items'}</span>
    </div>}
    {config.navigation && items.length > 1 && <div data-carousel-navigation="" style={{ position: 'absolute', bottom: 12, left: '50%',
      transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
      <button type="button" aria-label="Previous item" style={arrowStyle} onClick={event => navigate.current(-1, event.detail === 0)}>‹</button>
      <button type="button" aria-label="Next item" style={arrowStyle} onClick={event => navigate.current(1, event.detail === 0)}>›</button>
    </div>}
  </div>;
}
