'use client';
import { useEffect, useRef, useState, type VideoHTMLAttributes } from 'react';

export interface ViewportVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'children'> {
  fit?: 'cover' | 'contain' | 'fill';
  playInView?: boolean;
  static?: boolean;
}

/** Real video with viewport-driven playback. The poster remains visible if autoplay fails. */
export function RevymeViewportVideo({ src = '', poster, fit = 'cover', playInView = true, controls = false, muted = true, loop = true, static: isStatic = false, style, ...props }: ViewportVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let disposed = false;
    let observer: IntersectionObserver | undefined;
    const pause = () => { video.pause(); };
    const play = () => { if (!disposed) { const pending = video.play(); pending?.catch(() => {}); } };
    if (isStatic || reduced || !playInView) pause();
    else if (typeof IntersectionObserver === 'undefined') play();
    else {
      observer = new IntersectionObserver(entries => {
        if (disposed) return;
        if (entries.some(entry => entry.isIntersecting)) play(); else pause();
      }, { threshold: 0.1 });
      observer.observe(video);
    }
    return () => { disposed = true; observer?.disconnect(); pause(); };
  }, [src, playInView, isStatic, reduced]);
  return <video {...props} ref={ref} src={src || undefined} poster={poster || undefined} controls={controls} muted={muted} loop={loop} playsInline preload="none" style={{ display: 'block', width: '100%', height: '100%', objectFit: fit, ...style }} />;
}
