'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import qrcode from 'qrcode-generator';
import { finiteSetting } from './advanced-config';
import { richContentHeadings, richContentText } from './rich-content';

interface Typography {
  fontFamily?: string; fontSize?: number; lineHeight?: number; letterSpacing?: number; textColor?: string;
}
function typeStyle({ fontFamily = 'inherit', fontSize = 14, lineHeight = 1.2, letterSpacing = 0, textColor = 'inherit' }: Typography): CSSProperties {
  return { fontFamily, fontSize, lineHeight, letterSpacing: letterSpacing + 'em', color: textColor };
}
const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 };
function report(host: HTMLElement | null, component: string, state: string) {
  host?.dispatchEvent(new CustomEvent('revyme:editorial-state', { bubbles: true, detail: { nodeId: host.getAttribute('data-id'), component, state } }));
}

export interface ReadingTimeProps extends HTMLAttributes<HTMLSpanElement>, Typography {
  html?: string; wordsPerMinute?: number; prefix?: string; suffix?: string;
}
export function RevymeReadingTime({ html = '', wordsPerMinute = 200, prefix = 'LECTURA', suffix = 'MINUTOS',
  fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: ReadingTimeProps) {
  const words = richContentText(html).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const minutes = Math.ceil(words / finiteSetting(wordsPerMinute, 200, 1, 1000));
  return <span {...attributes} data-revyme-reading-time="" style={{ ...typeStyle({ fontFamily, fontSize, lineHeight, letterSpacing, textColor }), ...style }}>{prefix} {minutes} {suffix}</span>;
}

export interface ShareButtonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, Typography {
  title?: string; text?: string; url?: string; displayText?: string; mode?: 'naked' | 'button';
  backgroundColor?: string; hoverBackgroundColor?: string; hoverTextColor?: string;
  radius?: number; padding?: number; showIcon?: boolean; iconSrc?: string; iconSize?: number; iconSpacing?: number;
  textTransform?: CSSProperties['textTransform']; static?: boolean;
}
export function RevymeShareButton({ title = '', text = '', url = '', displayText = 'COMPARTE', mode = 'naked',
  backgroundColor = '#007aff', hoverBackgroundColor = '#0056cc', hoverTextColor = 'inherit', radius = 8, padding = 16,
  showIcon = true, iconSrc = '', iconSize = 16, iconSpacing = 8, textTransform = 'uppercase', static: isStatic = false,
  fontFamily, fontSize = 16, lineHeight, letterSpacing, textColor, style, ...attributes }: ShareButtonProps) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false), [status, setStatus] = useState(''), [fallback, setFallback] = useState('');
  async function share() {
    if (isStatic) return;
    const value = url || window.location.href;
    setStatus(''); setFallback('');
    if (navigator.share) {
      try { await navigator.share({ title, text, url: value }); report(root.current, 'share', 'shared'); return; }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value); setStatus('Enlace copiado'); report(root.current, 'share', 'copied');
    } catch { setFallback(value); setStatus('Copia este enlace para compartirlo'); report(root.current, 'share', 'manual-copy'); }
  }
  return <div {...attributes} ref={root} data-revyme-share="" style={{ position: 'relative', ...style }}>
    <button type="button" onClick={share} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}
      style={{ ...typeStyle({ fontFamily, fontSize, lineHeight, letterSpacing, textColor }), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: iconSpacing,
        width: '100%', height: '100%', cursor: 'pointer', border: 0, background: mode === 'naked' ? 'transparent' : hovered ? hoverBackgroundColor : backgroundColor,
        color: hovered ? hoverTextColor : textColor, borderRadius: radius, padding: mode === 'naked' ? 0 : padding, textTransform }}>
      {showIcon && (iconSrc ? <img src={iconSrc} alt="" width={iconSize} height={iconSize} style={{ objectFit: 'contain' }} /> : <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V2m-4 4 4-4 4 4M5 10H3v11h18V10h-2" /></svg>)}
      <span>{displayText}</span>
    </button>
    <span role="status" style={srOnly}>{status}</span>
    {fallback && <input aria-label="Enlace para compartir" readOnly value={fallback} onFocus={event => event.currentTarget.select()} style={{ display: 'block', width: '100%', marginTop: 8, font: 'inherit' }} />}
  </div>;
}

export interface ArticleTOCProps extends HTMLAttributes<HTMLElement>, Typography {
  html?: string; sectionId?: string; levels?: string | number; spacing?: number; indentation?: number; yOffset?: number;
  activeColor?: string; hoverColor?: string; activeFontWeight?: CSSProperties['fontWeight']; static?: boolean;
}
export function RevymeArticleTOC({ html = '', sectionId = 'content', levels = '2', spacing = 16, indentation = 0, yOffset = 0,
  activeColor = '#350adb', hoverColor = '#350adb', activeFontWeight = '700', static: isStatic = false,
  fontFamily, fontSize = 16, lineHeight, letterSpacing, textColor, style, ...attributes }: ArticleTOCProps) {
  const levelText = String(levels ?? '2');
  const levelValues = useMemo(() => levelText.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 6), [levelText]);
  const initial = useMemo(() => richContentHeadings(html, sectionId).filter(h => levelValues.includes(h.level)), [html, sectionId, levelValues]);
  const [headings, setHeadings] = useState(initial), [active, setActive] = useState(''), [hovered, setHovered] = useState('');
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    setHeadings(initial);
    if (isStatic) return;
    const doc = root.current!.ownerDocument;
    const selector = levelValues.map(n => 'h' + n).join(',');
    if (!selector) return;
    let observer: IntersectionObserver | undefined;
    let section: HTMLElement | null = null;
    const visible = new Set<string>();
    let known: { id: string; text: string; level: number }[] = initial;
    const scan = () => {
      const nextSection = doc.getElementById(sectionId);
      if (!nextSection) { section = null; observer?.disconnect(); visible.clear(); if (JSON.stringify(known) !== JSON.stringify(initial)) { known = initial; setHeadings(initial); } return; }
      section = nextSection;
      const elements = Array.from(section.querySelectorAll<HTMLElement>(selector)).filter(el => el.id);
      const next = elements.map(el => ({ id: el.id, text: el.textContent ?? '', level: Number(el.tagName.slice(1)) }));
      if (JSON.stringify(known) !== JSON.stringify(next)) { known = next; setHeadings(next); }
      observer?.disconnect(); visible.clear();
      if (typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id); }
        const first = known.find(heading => visible.has(heading.id));
        if (first) setActive(first.id);
      }, { rootMargin: -finiteSetting(yOffset, 0, -500, 1000) + 'px 0px -65% 0px' });
      elements.forEach(element => observer!.observe(element));
    };
    scan();
    const mutations = new MutationObserver(records => {
      // Ignore the TOC's own React commits; watch only arrival or changes of article content.
      if (!section || doc.getElementById(sectionId) !== section || records.some(record => section!.contains(record.target))) scan();
    });
    mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
    return () => { observer?.disconnect(); mutations.disconnect(); };
  }, [initial, sectionId, levelValues, yOffset, isStatic]);
  return <nav {...attributes} ref={root} aria-label={attributes['aria-label'] ?? 'Índice del artículo'} data-revyme-article-toc=""
    style={{ display: 'flex', flexDirection: 'column', gap: spacing, ...typeStyle({ fontFamily, fontSize, lineHeight, letterSpacing, textColor }), ...style }}>
    {headings.map(heading => <a key={heading.id} href={'#' + heading.id} aria-current={active === heading.id ? 'location' : undefined}
      onPointerEnter={() => setHovered(heading.id)} onPointerLeave={() => setHovered('')}
      onClick={event => {
        if (isStatic || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = root.current?.ownerDocument.getElementById(heading.id);
        if (!target) return;
        event.preventDefault(); const win = target.ownerDocument.defaultView!;
        win.history.replaceState(null, '', '#' + encodeURIComponent(heading.id));
        win.scrollTo({ top: target.getBoundingClientRect().top + win.scrollY - yOffset, behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        setActive(heading.id); report(root.current, 'toc', 'navigate');
      }} style={{ textDecoration: 'none', marginLeft: Math.max(0, heading.level - Math.min(...levelValues)) * indentation,
        color: active === heading.id ? activeColor : hovered === heading.id ? hoverColor : 'inherit', fontWeight: active === heading.id ? activeFontWeight : 'inherit' }}>{heading.text}</a>)}
  </nav>;
}

export interface QRCodeProps extends HTMLAttributes<HTMLDivElement> {
  value?: string; prefix?: string; suffix?: string; level?: 'L' | 'M' | 'Q' | 'H'; color?: string; backgroundColor?: string; padding?: number; radius?: number;
}
// The QR implementation supports pluggable byte encoders. Encode Unicode URLs as UTF-8.
qrcode.stringToBytes = value => Array.from(new TextEncoder().encode(value));
export function RevymeQRCode({ value = '', prefix = '', suffix = '', level = 'M', color = '#000000', backgroundColor = '#ffffff', padding = 10, radius = 0, style, ...attributes }: QRCodeProps) {
  const result = prefix + value + suffix;
  const encoded = useMemo(() => {
    if (!value) return null;
    try {
      const qr = qrcode(0, ['L','M','Q','H'].includes(level) ? level : 'M'); qr.addData(result); qr.make();
      const count = qr.getModuleCount(); let path = '';
      for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
      return { path, dimension: count + 8 };
    } catch { return null; }
  }, [value, result, level]);
  return <div {...attributes} data-revyme-qr="" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding, borderRadius: radius, backgroundColor, ...style }}>
    {encoded ? <svg role="img" aria-label={'Código QR: ' + result} viewBox={`0 0 ${encoded.dimension} ${encoded.dimension}`} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }} shapeRendering="crispEdges">
      <rect width={encoded.dimension} height={encoded.dimension} fill={backgroundColor} /><path d={encoded.path} fill={color} />
    </svg> : <span role="status" style={{ font: 'inherit', overflowWrap: 'anywhere' }}>{value ? 'No se pudo crear el QR' : 'Agrega un enlace'}</span>}
  </div>;
}

export interface AudioPlayerProps extends HTMLAttributes<HTMLDivElement> {
  audioUrl?: string; chapterLabel?: string; skipSeconds?: number; dotCount?: number; dotRadius?: number; dotGap?: number;
  backgroundColor?: string; accentColor?: string; inactiveDotColor?: string; timeColor?: string; labelColor?: string; controlsColor?: string;
  fontFamily?: string; timeFontSize?: number; labelFontSize?: number; labelLetterSpacing?: number;
  containerPadding?: string; containerRadius?: number; mainGap?: number; controlSize?: number;
  enableTextScroll?: boolean; scrollSpeed?: number; scrollDirection?: 'left' | 'right'; backdropBlur?: number; static?: boolean;
}
const clock = (seconds: number) => !Number.isFinite(seconds) ? '0:00' : Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
export function RevymeAudioPlayer({ audioUrl = '', chapterLabel = 'Escucha el capítulo', skipSeconds = 10, dotCount = 10, dotRadius = 0, dotGap = 2,
  backgroundColor = '#262626', accentColor = '#ffd65b', inactiveDotColor = '#edf2ed', timeColor = '#edf2ed', labelColor = '#edf2ed', controlsColor = '#edf2ed',
  fontFamily = 'inherit', timeFontSize = 10, labelFontSize = 12, labelLetterSpacing = 0.1, containerPadding = '10px', containerRadius = 0, mainGap = 16, controlSize = 20,
  enableTextScroll = true, scrollSpeed = 32, scrollDirection = 'left', backdropBlur = 0, static: isStatic = false, style, ...attributes }: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null), root = useRef<HTMLDivElement>(null), label = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false), [duration, setDuration] = useState(0), [time, setTime] = useState(0), [error, setError] = useState(''), [seekFocused, setSeekFocused] = useState(false);
  const count = Math.round(finiteSetting(dotCount, 10, 1, 100));
  useEffect(() => { setTime(0); setDuration(0); setPlaying(false); setError(''); }, [audioUrl]);
  useEffect(() => {
    const element = label.current!, win = element.ownerDocument.defaultView!, reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined, visible = typeof IntersectionObserver === 'undefined';
    const update = () => {
      animation?.cancel(); animation = undefined;
      const overflow = element.scrollWidth - (element.parentElement?.clientWidth ?? element.scrollWidth);
      if (!enableTextScroll || isStatic || reduced.matches || element.ownerDocument.hidden || !visible || overflow <= 0 || !element.animate) return;
      const distance = overflow + 16;
      animation = element.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (scrollDirection === 'right' ? distance : -distance) + 'px)' }], {
        duration: distance / finiteSetting(scrollSpeed, 32, 1, 300) * 1000, iterations: Infinity, direction: 'alternate', easing: 'linear',
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; update(); });
    observer?.observe(element.parentElement!); if (root.current) intersection?.observe(root.current); reduced.addEventListener('change', update); element.ownerDocument.addEventListener('visibilitychange', update); update();
    return () => { observer?.disconnect(); intersection?.disconnect(); animation?.cancel(); reduced.removeEventListener('change', update); element.ownerDocument.removeEventListener('visibilitychange', update); };
  }, [chapterLabel, enableTextScroll, scrollSpeed, scrollDirection, isStatic]);
  useEffect(() => { const element = audio.current; return () => { element?.pause(); }; }, [audioUrl]);
  const seek = (next: number) => { const player = audio.current; if (!player || !Number.isFinite(player.duration)) return; player.currentTime = Math.max(0, Math.min(player.duration, next)); setTime(player.currentTime); };
  const button: CSSProperties = { color: controlsColor, width: controlSize, height: controlSize, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  return <div {...attributes} ref={root} data-revyme-audio-player="" style={{ display: 'flex', alignItems: 'center', gap: mainGap, backgroundColor, padding: containerPadding, borderRadius: containerRadius, backdropFilter: backdropBlur ? `blur(${backdropBlur}px)` : undefined, ...style }}>
    <audio ref={audio} src={audioUrl || undefined} preload={isStatic ? 'none' : 'metadata'} onLoadedMetadata={() => setDuration(audio.current?.duration ?? 0)}
      onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)} onPlay={() => { setPlaying(true); report(root.current, 'audio', 'playing'); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { setError('No se pudo cargar el audio'); setPlaying(false); report(root.current, 'audio', 'error'); }} />
    <button type="button" aria-label={'Retroceder ' + skipSeconds + ' segundos'} disabled={isStatic || !audioUrl} style={button} onClick={() => seek(time - skipSeconds)}><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4H3v5M3 5a9 9 0 1 1-1 8" /><text x="12" y="15" textAnchor="middle" fontSize="8" stroke="none" fill="currentColor">{skipSeconds}</text></svg></button>
    <button type="button" aria-label={playing ? 'Pausar' : 'Reproducir'} disabled={isStatic || !audioUrl} style={button} onClick={async () => { if (!audio.current) return; if (playing) audio.current.pause(); else { try { await audio.current.play(); setError(''); } catch { setError('No se pudo reproducir el audio'); report(root.current, 'audio', 'play-error'); } } }}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">{playing ? <path d="M5 3h5v18H5zM14 3h5v18h-5z" /> : <path d="M6 3l15 9-15 9z" />}</svg>
    </button>
    <button type="button" aria-label={'Avanzar ' + skipSeconds + ' segundos'} disabled={isStatic || !audioUrl} style={button} onClick={() => seek(time + skipSeconds)}><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 4h5v5M21 5a9 9 0 1 0 1 8" /><text x="12" y="15" textAnchor="middle" fontSize="8" stroke="none" fill="currentColor">{skipSeconds}</text></svg></button>
    <div style={{ minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ overflow: 'hidden', color: labelColor, fontFamily, fontSize: labelFontSize, letterSpacing: labelLetterSpacing }}><span ref={label} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{chapterLabel}</span></div>
      <div style={{ position: 'relative', display: 'flex', gap: dotGap, height: 8, outline: seekFocused ? '2px solid ' + accentColor : undefined, outlineOffset: 4 }}>
        {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" style={{ flex: 1, borderRadius: dotRadius, background: duration && (index + 1) / count <= time / duration ? accentColor : inactiveDotColor }} />)}
        <input type="range" aria-label="Posición del audio" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)} disabled={isStatic || !duration} onFocus={() => setSeekFocused(true)} onBlur={() => setSeekFocused(false)} onChange={event => seek(Number(event.target.value))}
          style={{ position: 'absolute', inset: -6, width: 'calc(100% + 12px)', opacity: 0, cursor: 'pointer', margin: 0 }} />
      </div>
      <span aria-label="Tiempo de reproducción" style={{ color: timeColor, fontFamily, fontSize: timeFontSize, lineHeight: 1 }}>{clock(time)} / {clock(duration)}</span>
    </div>
    {error && <span role="status" style={{ color: timeColor, fontFamily, fontSize: timeFontSize, lineHeight: 1.2 }}>{error}</span>}
  </div>;
}

export interface DateTextProps extends HTMLAttributes<HTMLTimeElement>, Typography {
  value?: string; locale?: string; format?: 'day-month-year' | 'month-year' | 'year' | 'numeric'; timeZone?: string;
}
export function RevymeDateText({ value = '', locale = 'es-CL', format = 'day-month-year', timeZone = 'UTC',
  fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: DateTextProps) {
  const date = new Date(value), valid = value && Number.isFinite(date.getTime());
  let label = value;
  if (valid) {
    try {
      if (format === 'numeric') label = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(date);
      else {
        const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone }).formatToParts(date);
        const part = (type: string) => parts.find(p => p.type === type)?.value.replace(/\.$/, '') ?? '';
        label = format === 'year' ? part('year') : format === 'month-year' ? part('month') + ' ' + part('year') : part('day') + ' ' + part('month') + ' ' + part('year');
      }
    } catch { label = value; }
  }
  return <time {...attributes} dateTime={valid ? date.toISOString() : undefined} data-revyme-date="" style={{ ...typeStyle({ fontFamily, fontSize, lineHeight, letterSpacing, textColor }), ...style }}>{label}</time>;
}

export interface NumberTextProps extends HTMLAttributes<HTMLSpanElement>, Typography {
  value?: number | string; locale?: string; useGrouping?: boolean; notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
  minimumFractionDigits?: number; maximumFractionDigits?: number; format?: 'decimal' | 'percent' | 'currency'; currency?: string;
}
/** Display a CMS number with Intl; this does not animate or count. */
export function RevymeNumberText({ value = '', locale = 'es', useGrouping = true, notation = 'standard', minimumFractionDigits, maximumFractionDigits,
  format = 'decimal', currency = '', fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: NumberTextProps) {
  const numeric = typeof value === 'number' ? value : value.trim() ? Number(value) : NaN;
  let label = String(value);
  if (Number.isFinite(numeric)) {
    try {
      const options: Intl.NumberFormatOptions = { style: format, useGrouping, notation };
      if (minimumFractionDigits != null) options.minimumFractionDigits = Math.round(finiteSetting(minimumFractionDigits, 0, 0, 100));
      if (maximumFractionDigits != null) options.maximumFractionDigits = Math.round(finiteSetting(maximumFractionDigits, 3, 0, 100));
      if (format === 'currency' && /^[A-Za-z]{3}$/.test(currency)) options.currency = currency.toUpperCase();
      label = new Intl.NumberFormat(locale, options).format(numeric);
    } catch { /* Invalid locale or currency: preserve the underlying value. */ }
  }
  return <span {...attributes} data-revyme-number="" style={{ ...typeStyle({ fontFamily, fontSize, lineHeight, letterSpacing, textColor }), ...style }}>{label}</span>;
}
