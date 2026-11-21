'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RevymeAdvancedHeading, type AdvancedHeadingProps } from './advanced-heading';
export interface CycleHeadingProps extends Omit<AdvancedHeadingProps, 'text' | 'effect' | 'trigger'> {
  /** One phrase per line. */
  phrases?: string;
  pauseDuration?: number;
  mode?: 'scramble' | 'stagger';
  staggerDelay?: number;
  exitStaggerDelay?: number;
  easing?: 'smooth' | 'framer';
}
/** Rotating semantic copy with the same scramble engine as Advanced Heading. */
export function RevymeCycleHeading({ phrases = '', pauseDuration = 5, mode = 'scramble', staggerDelay = 0.035, exitStaggerDelay, easing = 'smooth', static: isStatic = false, ...props }: CycleHeadingProps) {
  const list = useMemo(() => phrases.split('\n').map(value => value.trim()).filter(Boolean), [phrases]);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setIndex(0); }, [phrases]);
  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const update = () => setReduced(!!query?.matches);
    update(); query?.addEventListener?.('change', update);
    return () => query?.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el || isStatic || reduced) { setVisible(false); return; }
    let inView = typeof IntersectionObserver === 'undefined';
    const refresh = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); refresh(); }, { threshold: 0.1 });
    observer?.observe(el); document.addEventListener('visibilitychange', refresh); refresh();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', refresh); };
  }, [isStatic, reduced]);
  useEffect(() => {
    if (!visible || isStatic || reduced || list.length < 2) return;
    const seconds = Number.isFinite(pauseDuration) ? Math.max(0.2, pauseDuration) : 5;
    const id = window.setTimeout(() => setIndex(value => (value + 1) % list.length), seconds * 1000);
    return () => window.clearTimeout(id);
  }, [visible, isStatic, reduced, list.length, pauseDuration, index]);
  const { style, ...attributes } = props;
  const nodeAttributes = attributes as Record<string, unknown>;
  const nodeId = nodeAttributes['data-id'] as string | undefined;
  const nodeName = nodeAttributes['data-name'] as string | undefined;
  delete nodeAttributes['data-id']; delete nodeAttributes['data-name'];
  if (mode === 'stagger') {
    const Tag = props.tag ?? 'p';
    const phrase = list[index % Math.max(1, list.length)] ?? '';
    const longest = list.reduce((a, b) => a.length >= b.length ? a : b, '');
    const typography = { margin: 0, fontFamily: props.fontFamily, fontSize: props.fontSize, fontWeight: props.fontWeight, lineHeight: props.lineHeight, letterSpacing: props.letterSpacing, color: props.color, textAlign: props.textAlign, textTransform: props.textTransform } as const;
    const duration = Math.max(0, props.duration ?? 0.55);
    const delay = Math.max(0, staggerDelay);
    const exitDelay = Math.max(0, exitStaggerDelay ?? staggerDelay);
    const ease: [number, number, number, number] = easing === 'framer' ? [0.11, 0.72, 0, 1] : [0.22, 1, 0.36, 1];
    return <div ref={root} data-id={nodeId} data-name={nodeName} style={{ position: 'relative', ...style }}>
      <Tag style={typography} aria-label={phrase}>
        <span aria-hidden="true" style={{ visibility: 'hidden', whiteSpace: 'pre' }}>{longest}</span>
        <span aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', whiteSpace: 'pre' }}>
          <AnimatePresence initial={false}>
            <motion.span key={index} style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'pre' }}>
              {Array.from(phrase).map((letter, i) => <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}><motion.span style={{ display: 'inline-block' }} initial={isStatic || reduced ? false : { y: '100%' }} animate={{ y: 0, transition: { duration, delay: i * delay, ease } }} exit={{ y: '-100%', transition: { duration, delay: i * exitDelay, ease } }}>{letter === ' ' ? '\u00a0' : letter}</motion.span></span>)}
            </motion.span>
          </AnimatePresence>
        </span>
      </Tag>
    </div>;
  }
  return <div ref={root} data-id={nodeId} data-name={nodeName} style={{ width: '100%', ...style }}><RevymeAdvancedHeading {...attributes} text={list[index % Math.max(1, list.length)] ?? ''} effect="scramble" trigger="appear" once={false} static={isStatic} /></div>;
}
