'use client';
import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';

export interface ImageLightboxProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  src?: string;
  fullSrc?: string;
  alt?: string;
  fit?: 'cover' | 'contain' | 'fill';
  radius?: number;
  padding?: number;
  maxWidth?: number;
  backdropColor?: string;
  stiffness?: number;
  damping?: number;
  mass?: number;
  openLabel?: string;
  closeLabel?: string;
  static?: boolean;
}

/** Native top-layer dialog preserves focus and escapes ancestor clipping/transforms. */
export function RevymeImageLightbox({ src = '', fullSrc, alt = '', fit = 'cover', radius = 0, padding = 20, maxWidth = 960, backdropColor = 'rgba(0,0,0,0.8)', stiffness = 400, damping = 30, mass = 1, openLabel = 'Open image', closeLabel = 'Close image', static: isStatic = false, style, ...props }: ImageLightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  const active = useRef(true);
  const closing = useRef(false);
  const transition = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness, damping, mass };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controls.stop(); };
  }, [controls]);
  useEffect(() => { if (isStatic) dialog.current?.close(); }, [isStatic]);
  const close = async () => {
    if (closing.current || !dialog.current?.open) return;
    closing.current = true;
    await controls.start({ opacity: 0, scale: reduced ? 1 : .96, transition });
    if (active.current) { dialog.current?.close(); closing.current = false; }
  };
  return <div {...props} data-revyme-image-lightbox-root style={{ position: 'relative', ...style }}>
    <a href={fullSrc || src || undefined} aria-label={alt || openLabel} onClick={event => {
      if (isStatic) { event.preventDefault(); return; }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      if (!dialog.current?.showModal) return;
      event.preventDefault();
      if (dialog.current.open) return;
      closing.current = false;
      controls.set({ opacity: 0, scale: reduced ? 1 : .96 });
      dialog.current.showModal();
      void controls.start({ opacity: 1, scale: 1, transition });
    }} style={{ display: 'block', width: '100%', height: '100%', cursor: isStatic ? 'default' : 'zoom-in', borderRadius: radius, overflow: 'hidden' }}>
      <img src={src || undefined} alt={alt} loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: fit }} />
    </a>
    <style>{'dialog[data-revyme-image-lightbox]::backdrop{background:var(--revyme-lightbox-backdrop)}'}</style>
    <dialog ref={dialog} data-revyme-image-lightbox aria-label={alt || closeLabel}
      onCancel={event => { event.preventDefault(); void close(); }}
      onClick={event => { if (event.target === event.currentTarget) void close(); }}
      style={{ '--revyme-lightbox-backdrop': backdropColor, padding: 0, border: 0, overflow: 'visible', background: 'transparent', width: `calc(100vw - ${Math.max(0, padding) * 2}px)`, maxWidth, maxHeight: `calc(100dvh - ${Math.max(0, padding) * 2}px)`, color: '#ffffff' } as CSSProperties}>
      <motion.div initial={false} animate={controls} style={{ position: 'relative', width: '100%' }}>
        <img src={fullSrc || src || undefined} alt={alt} style={{ display: 'block', width: '100%', maxHeight: `calc(100dvh - ${Math.max(0, padding) * 2}px)`, objectFit: 'contain' }} />
        <button type="button" aria-label={closeLabel} onClick={() => { void close(); }} style={{ position: 'absolute', top: 8, right: 8, display: 'grid', placeItems: 'center', width: 40, height: 40, border: '1px solid rgba(255,255,255,.5)', borderRadius: '50%', background: 'rgba(0,0,0,.7)', color: '#ffffff', font: '28px/1 sans-serif', cursor: 'pointer' }}>×</button>
      </motion.div>
    </dialog>
  </div>;
}
