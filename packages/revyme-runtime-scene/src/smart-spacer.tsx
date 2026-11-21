'use client';
import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

type DimensionSource = 'targetWidth' | 'targetHeight' | 'none';
export interface SmartSpacerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  sourceMode?: 'id' | 'selector'; targetId?: string; targetSelector?: string;
  widthFrom?: DimensionSource; heightFrom?: DimensionSource;
  wScale?: number; hScale?: number; wOffset?: number; hOffset?: number;
  wMin?: number; hMin?: number; wMax?: number; hMax?: number;
  fallbackWidth?: number; fallbackHeight?: number; preferFallbackInCanvas?: boolean;
  background?: string; static?: boolean;
}
const bounded = (value: number, min: number, max: number) => Math.max(min, max > 0 ? Math.min(max, value) : value);
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

/** Dimension spacer observing a named target, with deterministic SSR/static fallback. */
export function RevymeSmartSpacer({ sourceMode='id', targetId='', targetSelector='', widthFrom='targetHeight', heightFrom='targetHeight',
  wScale=1, hScale=1, wOffset=0, hOffset=0, wMin=0, hMin=0, wMax=0, hMax=0,
  fallbackWidth=16, fallbackHeight=16, preferFallbackInCanvas=true, background='transparent', static:isStatic=false, style, ...props }: SmartSpacerProps) {
  const host=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState<{width:number;height:number}|null>(null);
  useEffect(() => {
    if (isStatic && preferFallbackInCanvas) { setSize(null); return; }
    let target: Element | null = null;
    let resize: ResizeObserver | undefined;
    let disposed = false;
    const measure = () => {
      if (!target || disposed) return;
      const rect=target.getBoundingClientRect();
      setSize(previous => previous?.width===rect.width && previous.height===rect.height ? previous : {width:rect.width,height:rect.height});
    };
    const findTarget = () => {
      try {
        const node = sourceMode==='selector' ? (targetSelector ? document.querySelector(targetSelector) : null) : (targetId ? document.getElementById(targetId.replace(/^#/,'')) : null);
        return node === host.current ? null : node;
      } catch { return null; }
    };
    const connect = () => {
      const next=findTarget();
      if (next===target) return;
      resize?.disconnect(); resize=undefined; target=next;
      if (!target) { setSize(null); return; }
      measure();
      if (typeof ResizeObserver !== 'undefined') { resize=new ResizeObserver(measure); resize.observe(target); }
    };
    connect();
    const mutation=typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(connect);
    mutation?.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['id']});
    return () => { disposed=true; mutation?.disconnect(); resize?.disconnect(); };
  },[sourceMode,targetId,targetSelector,isStatic,preferFallbackInCanvas]);
  const dimension=(source:DimensionSource, fallback:number, scale:number, offset:number, min:number, max:number) => {
    if (!size || source==='none') return bounded(finite(fallback,16),finite(min,0),finite(max,0));
    const base=source==='targetWidth'?size.width:size.height;
    return bounded(base*finite(scale,1)+finite(offset,0),finite(min,0),finite(max,0));
  };
  return <div {...props} ref={host} aria-hidden="true" style={{...style,backgroundColor:background,width:dimension(widthFrom,fallbackWidth,wScale,wOffset,wMin,wMax),height:dimension(heightFrom,fallbackHeight,hScale,hOffset,hMin,hMax),flex:'0 0 auto'}} />;
}
