'use client';
import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

export interface SmartEyeProps extends HTMLAttributes<HTMLDivElement> {
  eyeImage?: string; irisImage?: string; eyeWidth?: number; eyeHeight?: number;
  irisWidth?: number; irisHeight?: number; trackingIntensity?: number; verticalIntensity?: number; static?: boolean;
}
/** Pointer tracking matches the original Smart_Eye window-based spring mapping. */
export function RevymeSmartEye({ eyeImage = '', irisImage = '', eyeWidth = 200, eyeHeight = 100, irisWidth = 50, irisHeight = 50, trackingIntensity: _trackingIntensity = .5, verticalIntensity = .5, static: isStatic = false, style, ...props }: SmartEyeProps) {
  const root = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: eyeWidth, height: eyeHeight });
  const mouseX = useMotionValue(0), mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { damping: 25, stiffness: 200 }), springY = useSpring(mouseY, { damping: 25, stiffness: 200 });
  const irisWidthPx = size.width * irisWidth / Math.max(1, eyeWidth), irisHeightPx = size.height * irisHeight / Math.max(1, eyeHeight);
  const irisX = useTransform(springX, [-1, 1], [-(size.width - irisWidthPx) * .5, (size.width - irisWidthPx) * .5]);
  const irisY = useTransform(springY, [-1, 1], [-(size.height - irisHeightPx) * verticalIntensity, (size.height - irisHeightPx) * verticalIntensity]);
  useEffect(() => {
    const host = root.current, win = host?.ownerDocument.defaultView; if (!host || !win) return;
    const media = win.matchMedia('(prefers-reduced-motion: reduce)');
    const move = (event: MouseEvent) => { if (isStatic || media.matches) return; mouseX.set(Math.max(-1, Math.min(1, event.clientX / Math.max(1, win.innerWidth) * 2 - 1))); mouseY.set(Math.max(-1, Math.min(1, event.clientY / Math.max(1, win.innerHeight) * 2 - 1))); };
    const onMotion = () => { if (isStatic || media.matches) { mouseX.jump(0); mouseY.jump(0); springX.jump(0); springY.jump(0); } };
    onMotion();
    const resize = () => setSize({ width: host.clientWidth || eyeWidth, height: host.clientHeight || eyeHeight });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
    observer?.observe(host); resize(); if (!isStatic) win.addEventListener('mousemove', move, { passive: true }); media.addEventListener('change', onMotion);
    return () => { observer?.disconnect(); win.removeEventListener('mousemove', move); media.removeEventListener('change', onMotion); };
  }, [eyeWidth, eyeHeight, isStatic, mouseX, mouseY, springX, springY]);
  // The Framer source exposed trackingIntensity but did not consume it; retain that contract.
  return <div {...props} ref={root} style={{ position: 'relative', overflow: 'hidden', width: eyeWidth, height: eyeHeight, ...style }}>
    {eyeImage && <img src={eyeImage} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
    {irisImage && <motion.img src={irisImage} alt="" aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: irisWidthPx, height: irisHeightPx, marginLeft: -irisWidthPx / 2, marginTop: -irisHeightPx / 2, x: irisX, y: irisY }} />}
  </div>;
}
