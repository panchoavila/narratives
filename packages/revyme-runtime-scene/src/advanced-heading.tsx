'use client';

import { createElement, useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { DEFAULT_ADVANCED_HEADING as defaults, finiteSetting, HEADING_EFFECTS, HEADING_TAGS } from './advanced-config';

export interface AdvancedHeadingProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  text?: string;
  prefix?: string;
  suffix?: string;
  tag?: typeof HEADING_TAGS[number];
  effect?: typeof HEADING_EFFECTS[number];
  trigger?: 'appear' | 'hover';
  duration?: number;
  delay?: number;
  once?: boolean;
  scrambledColor?: string;
  characters?: string;
  cursor?: boolean;
  cursorColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  textAlign?: CSSProperties['textAlign'];
  textTransform?: CSSProperties['textTransform'];
  textWrap?: CSSProperties['textWrap'];
  static?: boolean;
}

/** The semantic text owns layout. Animation only touches an aria-hidden visual copy. */
export function RevymeAdvancedHeading({
  text = defaults.text, prefix = defaults.prefix, suffix = defaults.suffix, tag = defaults.tag, effect = defaults.effect, trigger = defaults.trigger,
  duration = defaults.duration, delay = defaults.delay, once = defaults.once,
  scrambledColor = defaults.scrambledColor, characters = defaults.characters, cursor = defaults.cursor, cursorColor = defaults.cursorColor,
  fontFamily = defaults.fontFamily, fontSize = defaults.fontSize, fontWeight = defaults.fontWeight,
  lineHeight = defaults.lineHeight, letterSpacing = defaults.letterSpacing, color = defaults.color,
  textAlign = defaults.textAlign, textTransform = defaults.textTransform, textWrap = defaults.textWrap,
  static: isStatic = false, style, ...attributes
}: AdvancedHeadingProps) {
  const root = useRef<HTMLElement>(null);
  const original = useRef<HTMLSpanElement>(null);
  const visual = useRef<HTMLSpanElement>(null);
  const content = String(prefix ?? '') + String(text ?? '') + String(suffix ?? '');
  const safeEffect = HEADING_EFFECTS.includes(effect) ? effect : 'none';

  useEffect(() => {
    const host = root.current!, source = original.current!, overlay = visual.current!;
    const doc = host.ownerDocument, win = doc.defaultView!;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const seconds = finiteSetting(duration, defaults.duration, 0, 30);
    const wait = finiteSetting(delay, 0, 0, 30) * 1000;
    const Segmenter = (Intl as typeof Intl & { Segmenter?: new(locales: undefined, options: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
    const graphemes = Segmenter
      ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(content), s => s.segment)
      : Array.from(content);
    const alphabet = Array.from(characters || defaults.characters);
    let raf = 0, timer = 0, played = false, visible = false, running = false, disposed = false;
    let lastStep = -1;
    function emit(state: string) {
      if (host.dataset.headingState === state) return;
      host.dataset.headingState = state;
      host.dispatchEvent(new CustomEvent('revyme:heading-state', { bubbles: true, detail: { nodeId: host.getAttribute('data-id'), state, effect: safeEffect } }));
    }
    function idleState() { return isStatic ? 'static' : reduced.matches ? 'reduced-motion' : 'idle'; }
    function stop() {
      win.cancelAnimationFrame(raf); win.clearTimeout(timer); raf = timer = 0;
      running = false; source.style.opacity = '1'; overlay.style.visibility = 'hidden';
      overlay.style.transform = ''; overlay.style.opacity = ''; overlay.textContent = content;
      emit(idleState());
    }
    function play() {
      if (disposed || running || isStatic || reduced.matches || doc.hidden || safeEffect === 'none' || !seconds || !content) { emit(idleState()); return; }
      if (trigger === 'appear' && once && played) return;
      running = true; played = true; lastStep = -1;
      timer = win.setTimeout(() => {
        timer = 0;
        source.style.opacity = '0'; overlay.style.visibility = 'visible';
        overlay.style.opacity = safeEffect === 'reveal' ? '0' : '1';
        const letters = safeEffect === 'reveal' ? [] : graphemes.map(letter => {
          const span = doc.createElement('span'); span.textContent = letter; return span;
        });
        const caret = cursor && safeEffect === 'typewriter' ? doc.createElement('span') : null;
        if (caret) {
          caret.dataset.headingCursor = '';
          Object.assign(caret.style, { display: 'inline-block', width: '0.32em', height: '1.1em', backgroundColor: cursorColor, verticalAlign: 'middle' });
        }
        if (letters.length) overlay.replaceChildren(...letters);
        emit('running');
        const start = win.performance.now();
        function tick(now: number) {
          if (disposed) return;
          const progress = Math.min(1, (now - start) / (seconds * 1000));
          if (progress >= 1) {
            if (caret) {
              graphemes.forEach((letter, index) => { letters[index].textContent = letter; letters[index].style.color = ''; });
              overlay.appendChild(caret); running = false; raf = 0; emit('complete');
            } else stop();
            return;
          }
          if (safeEffect === 'reveal') {
            overlay.textContent = content;
            overlay.style.opacity = String(progress);
            overlay.style.transform = 'translateY(' + ((1 - progress) * 0.25) + 'em)';
          } else {
            // At most 30 text updates/sec; layout remains owned by the original text.
            const step = Math.floor((now - start) / 33);
            if (step !== lastStep) {
              lastStep = step;
              const resolved = Math.floor(progress * graphemes.length);
              graphemes.forEach((letter, index) => {
                const span = letters[index];
                const scrambled = index >= resolved && !/^\s+$/.test(letter);
                span.textContent = !scrambled ? letter : safeEffect === 'typewriter' ? '\u00a0' : alphabet[(index * 17 + step * 13) % alphabet.length];
                span.style.color = scrambled ? safeEffect === 'typewriter' ? 'transparent' : scrambledColor : '';
              });
              if (caret) overlay.insertBefore(caret, letters[resolved] ?? null);
            }
          }
          raf = win.requestAnimationFrame(tick);
        }
        raf = win.requestAnimationFrame(tick);
      }, wait);
    }
    function changed() {
      stop();
      if (!doc.hidden && !reduced.matches && visible && trigger === 'appear') play();
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible && trigger === 'appear') play();
      if (!visible) stop();
    }) : undefined;
    if (observer) observer.observe(host); else { visible = true; if (trigger === 'appear') play(); }
    if (trigger === 'hover') host.addEventListener('pointerenter', play);
    if (trigger === 'hover') host.addEventListener('pointerleave', stop);
    reduced.addEventListener('change', changed); doc.addEventListener('visibilitychange', changed);
    emit(idleState());
    return () => {
      disposed = true; stop(); observer?.disconnect();
      host.removeEventListener('pointerenter', play); host.removeEventListener('pointerleave', stop);
      reduced.removeEventListener('change', changed); doc.removeEventListener('visibilitychange', changed);
    };
  }, [content, safeEffect, trigger, duration, delay, once, scrambledColor, characters, cursor, cursorColor, isStatic]);

  const resolvedStyle: CSSProperties = { position: 'relative', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    fontFamily, fontSize: finiteSetting(fontSize, defaults.fontSize, 1, 1000), fontWeight,
    lineHeight: finiteSetting(lineHeight, defaults.lineHeight, 0.5, 10), letterSpacing: finiteSetting(letterSpacing, 0, -1, 10) + 'em',
    color, textAlign, textTransform, textWrap, ...style };
  return createElement(HEADING_TAGS.includes(tag) ? tag : 'h2', {
    ...attributes, ref: root, style: resolvedStyle, 'data-revyme-advanced-heading': '',
  }, <span style={{ position: 'relative', display: 'block' }}>
    <span ref={original}>{content}</span>
    <span ref={visual} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none', visibility: 'hidden', font: 'inherit', letterSpacing: 'inherit', textAlign: 'inherit' }}>{content}</span>
  </span>);
}
