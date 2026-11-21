'use client';

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { CORNER_STYLES, DEFAULT_ADVANCED_FRAME as defaults, finiteSetting, PATTERN_PRESETS } from './advanced-config';

export interface AdvancedFrameProps extends HTMLAttributes<HTMLDivElement> {
  fillColor?: string;
  cornerStyle?: typeof CORNER_STYLES[number];
  cornerSize?: number;
  cornerStroke?: number;
  cornerColor?: string;
  cornerFill?: string;
  cornerOffsetX?: number;
  cornerOffsetY?: number;
  patternPreset?: typeof PATTERN_PRESETS[number];
  patternColor?: string;
  tileSize?: number;
  lineWidth?: number;
  dotSize?: number;
  flip?: boolean;
  customPatternImage?: string;
  customPatternSizing?: 'fill' | 'fit' | 'stretch' | 'tile';
  customPatternPosition?: string;
  customPatternMode?: 'alpha' | 'luminance';
  patternMotion?: 'none' | 'shimmer';
  patternDuration?: number;
  compositionMaskImage?: string;
  compositionMaskMode?: 'alpha' | 'luminance';
  compositionMaskSizing?: 'fill' | 'fit' | 'stretch' | 'tile';
  compositionMaskPosition?: string;
  compositionMaskTileSize?: number;
  static?: boolean;
}

const imagePositions: Record<string, string> = { topLeft: 'left top', topCenter: 'center top', topRight: 'right top', left: 'left center', center: 'center', right: 'right center', bottomLeft: 'left bottom', bottomCenter: 'center bottom', bottomRight: 'right bottom' };

/** A composition mask acts AFTER content and decoration, unlike the background pattern mask. */
function compositionMaskStyle(props: AdvancedFrameProps): CSSProperties {
  if (!props.compositionMaskImage) return {};
  const sizing = props.compositionMaskSizing ?? defaults.compositionMaskSizing;
  const tile = finiteSetting(props.compositionMaskTileSize, defaults.compositionMaskTileSize, 1, 4096);
  return { maskImage: 'url(' + JSON.stringify(props.compositionMaskImage) + ')',
    maskMode: props.compositionMaskMode ?? defaults.compositionMaskMode,
    maskSize: sizing === 'fill' ? 'cover' : sizing === 'fit' ? 'contain' : sizing === 'stretch' ? '100% 100%' : tile + 'px ' + tile + 'px',
    maskPosition: imagePositions[props.compositionMaskPosition ?? 'center'] ?? 'center', maskRepeat: sizing === 'tile' ? 'repeat' : 'no-repeat' };
}

/** Pattern geometry is CSS, so it remains crisp, responsive and independent of a GPU. */
function patternStyle(props: AdvancedFrameProps): CSSProperties {
  const color = props.patternColor ?? defaults.patternColor;
  const tile = finiteSetting(props.tileSize, defaults.tileSize, 1, 1000);
  const line = finiteSetting(props.lineWidth, defaults.lineWidth, 0, tile);
  const dot = finiteSetting(props.dotSize, defaults.dotSize, 0, tile);
  const size = tile + 'px ' + tile + 'px';
  const horizontal = 'linear-gradient(' + color + ' ' + line + 'px, transparent ' + line + 'px)';
  const vertical = 'linear-gradient(90deg, ' + color + ' ' + line + 'px, transparent ' + line + 'px)';
  switch (props.patternPreset) {
    case 'grid': return { backgroundImage: horizontal + ',' + vertical, backgroundSize: size };
    case 'horizontalLines': return { backgroundImage: horizontal, backgroundSize: size };
    case 'verticalLines': return { backgroundImage: vertical, backgroundSize: size };
    case 'diagonalLines': return { backgroundImage: 'repeating-linear-gradient(' + (props.flip ? -45 : 45) + 'deg, ' + color + ' 0 ' + line + 'px, transparent ' + line + 'px ' + tile + 'px)' };
    case 'checkerboard': return { backgroundImage: 'conic-gradient(' + color + ' 25%, transparent 0 50%, ' + color + ' 0 75%, transparent 0)', backgroundSize: size };
    case 'dots': {
      // A 1px dot with a 0.7px outer radius can fall between all pixel centers
      // at DPR 1. Framer's soft edge keeps those small dots visible.
      if (dot === 0) return { backgroundImage: 'none', backgroundSize: size };
      const inner = dot <= 1 ? Math.max(0, Math.round((dot / 2 - 0.4) * 1000) / 1000) : dot / 2;
      const outer = dot <= 1 ? dot / 2 + 0.4 : dot / 2 + 0.2;
      return { backgroundImage: 'radial-gradient(circle, ' + color + ' ' + inner + 'px, transparent ' + outer + 'px)', backgroundSize: size };
    }
    case 'triangles': return { backgroundImage: 'linear-gradient(' + (props.flip ? -45 : 45) + 'deg, ' + color + ' 50%, transparent 50%)', backgroundSize: size };
    case 'custom': {
      if (!props.customPatternImage) return {};
      const mode = props.customPatternSizing ?? 'tile';
      return { backgroundColor: color, maskImage: 'url(' + JSON.stringify(props.customPatternImage) + ')',
        maskMode: props.customPatternMode ?? 'alpha', maskSize: mode === 'fill' ? 'cover' : mode === 'fit' ? 'contain' : mode === 'stretch' ? '100% 100%' : size,
        maskPosition: imagePositions[props.customPatternPosition ?? 'center'] ?? 'center', maskRepeat: mode === 'tile' ? 'repeat' : 'no-repeat',
        transform: props.flip ? 'scaleX(-1)' : undefined };
    }
    default: return {};
  }
}

/** Native children retain layout, focus and events; decoration never participates in layout or input. */
export function RevymeAdvancedFrame(props: AdvancedFrameProps) {
  const { children, style, static: isStatic = false } = props;
  const corners = CORNER_STYLES.includes(props.cornerStyle ?? defaults.cornerStyle) ? props.cornerStyle ?? defaults.cornerStyle : 'none';
  const pattern = PATTERN_PRESETS.includes(props.patternPreset ?? 'none') ? props.patternPreset ?? 'none' : 'none';
  const size = finiteSetting(props.cornerSize, defaults.cornerSize, 0, 300);
  const stroke = finiteSetting(props.cornerStroke, defaults.cornerStroke, 0, 30);
  const x = finiteSetting(props.cornerOffsetX, 0, -1000, 1000), y = finiteSetting(props.cornerOffsetY, 0, -1000, 1000);
  const root = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const attributes = { ...props } as Record<string, unknown>;
  for (const key of [...Object.keys(defaults), 'children', 'style', 'static']) delete attributes[key];

  useEffect(() => {
    const host = root.current!, layer = surface.current!;
    const doc = host.ownerDocument, win = doc.defaultView!;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined, visible = false;
    function update() {
      const active = props.patternMotion === 'shimmer' && pattern !== 'none' && visible && !isStatic && !reduced.matches && !doc.hidden && typeof layer.animate === 'function';
      if (!active) { animation?.cancel(); animation = undefined; }
      else if (!animation) animation = layer.animate([{ opacity: 0.35 }, { opacity: 1 }, { opacity: 0.35 }], {
        duration: finiteSetting(props.patternDuration, defaults.patternDuration, 0.2, 60) * 1000, iterations: Infinity, easing: 'ease-in-out',
      });
      const state = active ? 'running' : isStatic ? 'static' : reduced.matches ? 'reduced-motion' : 'idle';
      if (host.dataset.frameState !== state) {
        host.dataset.frameState = state;
        host.dispatchEvent(new CustomEvent('revyme:frame-state', { bubbles: true, detail: { nodeId: host.getAttribute('data-id'), state } }));
      }
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; update(); }) : undefined;
    if (observer) observer.observe(host); else visible = true;
    reduced.addEventListener('change', update); doc.addEventListener('visibilitychange', update); update();
    return () => { animation?.cancel(); observer?.disconnect(); reduced.removeEventListener('change', update); doc.removeEventListener('visibilitychange', update); };
  }, [props.patternMotion, props.patternDuration, pattern, isStatic]);

  return <div {...attributes} ref={root} data-revyme-advanced-frame="" style={{ position: 'relative', isolation: 'isolate', overflow: 'visible', backgroundColor: props.fillColor ?? defaults.fillColor, ...style, ...compositionMaskStyle(props) }}>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none', zIndex: -1 }}>
      <div ref={surface} data-frame-pattern={pattern} style={{ position: 'absolute', inset: 0, ...patternStyle({ ...props, patternPreset: pattern }) }} />
    </div>
    {children}
    {corners !== 'none' && [0, 1, 2, 3].map(index => {
      const right = index === 1 || index === 2, bottom = index >= 2;
      return <svg key={index} data-frame-corner={index} aria-hidden="true" focusable="false" viewBox="0 0 16 16" width={size} height={size}
        style={{ position: 'absolute', pointerEvents: 'none', overflow: 'visible', zIndex: 1,
          left: right ? undefined : x, right: right ? x : undefined, top: bottom ? undefined : y, bottom: bottom ? y : undefined,
          transform: 'translate(' + (right ? '50%' : '-50%') + ', ' + (bottom ? '50%' : '-50%') + ')',
          color: props.cornerColor ?? defaults.cornerColor }}>
        {(corners === 'square' || corners === 'crossSquare') && <rect x="0.5" y="0.5" width="15" height="15" fill={props.cornerFill ?? defaults.cornerFill} stroke="currentColor" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />}
        {(corners === 'cross' || corners === 'crossSquare') && <path d="M8 0V16M0 8H16" fill="none" stroke="currentColor" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />}
        {corners === 'dot' && <circle cx="8" cy="8" r="7" fill="currentColor" />}
        {corners === 'bracket' && <path d="M15 1H1V15" transform={'rotate(' + (index * 90) + ' 8 8)'} fill="none" stroke="currentColor" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />}
      </svg>;
    })}
  </div>;
}
