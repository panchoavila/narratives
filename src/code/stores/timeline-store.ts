// timeline-store.ts — Derived Jotai state for the editor Animation Timeline.
//
// Aggregates all declared animations across the active page and project:
//   - DOM element CSS @keyframes animations (`style.animation`) with stops
//   - DOM element CSS transitions (`style.transition`)
//   - DOM element Motion animations (`whileInView`, `animate`, `whileHover`, `whileTap`, `data-scroll-fx`)
//   - DOM element text animations (`data-text-anim`)
//   - DOM element scroll-linked animations (`useScroll` / `data-scroll-fx`)
//   - Page-level View Transitions (`_meta/page-effects.json`) and Smooth Scroll (`Lenis`)
//
// Code in ProjectFS remains the single source of truth.

import { atom } from 'jotai';
import { nodesAtom, stableCodeAtom } from './store';
import { keyframesAtom, scrollAnimDataAtom, textAnimCallsAtom } from './animation-store';
import { activeFilePathAtom, getFileDisplayName } from '@/code/project/active-file-store';
import { projectVersionAtom } from '@/code/project/project-fs';
import { getEffectsForPage } from '@/code/project/page-effects-ops';
import { getSmoothScrollForPage } from '@/code/project/smooth-scroll-ops';
import {
  parseAnimationShorthand,
  parseTransitionShorthand,
  parseKeyframes,
  type KeyframeStop,
} from '@/shared/animation-utils';
import { getTextAnimForNode } from '@/code/parsing/text-anim-parser';
import { getScrollDataForNode } from '@/code/parsing/scroll-parser';

export type TimelineScope = 'page' | 'dom';
export type TimelineTrackKind =
  | 'keyframe'
  | 'transition'
  | 'motion'
  | 'text'
  | 'scroll'
  | 'page-transition'
  | 'smooth-scroll';

export type TimelineTrigger =
  | 'load'
  | 'appear'
  | 'hover'
  | 'tap'
  | 'loop'
  | 'transition'
  | 'scroll'
  | 'page';

export interface TimelineTrack {
  id: string;
  scope: TimelineScope;
  nodeId: string;
  nodeName: string;
  nodeTag: string;
  pageLabel: string;
  kind: TimelineTrackKind;
  trigger: TimelineTrigger;
  label: string;
  delay: number;      // seconds (start offset)
  duration: number;   // seconds
  easing: string;
  iterationCount: string;
  fillMode?: string;
  direction?: string;
  stops: KeyframeStop[];
  scrollRange?: [number, number];
  editable: boolean;
  styleProp?: 'animation' | 'transition';
  animIndex?: number;
}

export const timelineOpenAtom = atom<boolean>(false);
export const timelineFilterAtom = atom<'all' | 'dom' | 'page' | 'scroll'>('all');
export const timelinePlayheadAtom = atom<number>(0);

function parseSecondsValue(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.endsWith('ms')) {
      const n = parseFloat(trimmed);
      return Number.isFinite(n) ? Math.max(0, n / 1000) : fallback;
    }
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }
  return fallback;
}

export const timelineTracksAtom = atom<TimelineTrack[]>((get) => {
  const nodes = get(nodesAtom);
  const activeFile = get(activeFilePathAtom) || 'app/page.client.tsx';
  const code = get(stableCodeAtom);
  const globalKeyframes = get(keyframesAtom);
  const textAnims = get(textAnimCallsAtom);
  const scrollData = get(scrollAnimDataAtom);
  get(projectVersionAtom);

  const rawPageLabel = getFileDisplayName(activeFile);
  const pageLabel = rawPageLabel === '/' ? 'Home' : rawPageLabel;

  // Merge @keyframes from app/globals.css and any inline <style> in the active page
  const inlineKeyframes = parseKeyframes(code);
  const keyframeByName = new Map<string, KeyframeStop[]>();
  for (const kf of globalKeyframes) keyframeByName.set(kf.name, kf.stops);
  for (const kf of inlineKeyframes) keyframeByName.set(kf.name, kf.stops);

  const tracks: TimelineTrack[] = [];

  // 1. Page-level View Transitions
  const pageEffects = getEffectsForPage(activeFile);
  for (const effect of pageEffects) {
    const dur = parseSecondsValue((effect as any).duration, 0.45);
    tracks.push({
      id: `page:transition:${effect.target}`,
      scope: 'page',
      nodeId: 'root',
      nodeName: pageLabel,
      nodeTag: 'page',
      pageLabel,
      kind: 'page-transition',
      trigger: 'page',
      label: `View Transition → ${effect.target} (${effect.preset})`,
      delay: 0,
      duration: dur,
      easing: String((effect as any).easing || 'ease-in-out'),
      iterationCount: '1',
      stops: [
        { offset: 0, properties: { preset: effect.preset } },
        { offset: 100, properties: { target: effect.target } },
      ],
      editable: false,
    });
  }

  // 2. Page-level Smooth Scroll (Lenis)
  const smoothScroll = getSmoothScrollForPage(activeFile);
  if (smoothScroll?.effective?.enabled) {
    const dur = Math.max(0.4, (smoothScroll.effective.intensity / 100) * 2.0);
    tracks.push({
      id: `page:smooth-scroll`,
      scope: 'page',
      nodeId: 'root',
      nodeName: pageLabel,
      nodeTag: 'page',
      pageLabel,
      kind: 'smooth-scroll',
      trigger: 'scroll',
      label: `Smooth Scroll (Lenis · ${smoothScroll.effective.intensity}%)`,
      delay: 0,
      duration: dur,
      easing: 'expo-out',
      iterationCount: 'continuous',
      stops: [
        { offset: 0, properties: { lerp: 'start' } },
        { offset: 100, properties: { intensity: `${smoothScroll.effective.intensity}%` } },
      ],
      editable: false,
    });
  }

  // 3. DOM Element Animations
  nodes.forEach((node: any, nodeId: string) => {
    const nodeName = node.name || node.attrs?.['data-name'] || nodeId;
    const nodeTag = node.tag || node.type || 'div';
    const styles: Record<string, string> = node.styles || {};

    // 3a. CSS @keyframes animations (`style.animation`)
    if (styles.animation) {
      const anims = parseAnimationShorthand(styles.animation);
      anims.forEach((anim, idx) => {
        const stops = keyframeByName.get(anim.keyframeName) ?? [
          { offset: 0, properties: {} },
          { offset: 100, properties: {} },
        ];
        tracks.push({
          id: `${nodeId}:keyframe:${idx}`,
          scope: 'dom',
          nodeId,
          nodeName,
          nodeTag,
          pageLabel,
          kind: 'keyframe',
          trigger: anim.iterationCount === 'infinite' ? 'loop' : 'load',
          label: anim.keyframeName,
          delay: anim.delay,
          duration: anim.duration,
          easing: anim.easing,
          iterationCount: anim.iterationCount,
          fillMode: anim.fillMode,
          direction: anim.direction,
          stops,
          editable: true,
          styleProp: 'animation',
          animIndex: idx,
        });
      });
    }

    // 3b. CSS transitions (`style.transition`)
    if (styles.transition) {
      const transitions = parseTransitionShorthand(styles.transition);
      transitions.forEach((tr, idx) => {
        tracks.push({
          id: `${nodeId}:transition:${idx}`,
          scope: 'dom',
          nodeId,
          nodeName,
          nodeTag,
          pageLabel,
          kind: 'transition',
          trigger: 'transition',
          label: `transition (${tr.property})`,
          delay: tr.delay,
          duration: tr.duration,
          easing: tr.easing,
          iterationCount: '1',
          stops: [
            { offset: 0, properties: { property: tr.property } },
            { offset: 100, properties: { property: tr.property } },
          ],
          editable: true,
          styleProp: 'transition',
          animIndex: idx,
        });
      });
    }

    // 3c. Motion props (`whileInView`, `animate`, `whileHover`, `whileTap`, `data-scroll-fx`)
    const mp = node.motionProps;
    const transitionObj = mp?.transition ?? {};
    const motionDelay = parseSecondsValue(transitionObj.delay, 0);
    const motionDur = parseSecondsValue(transitionObj.duration, 0.6);
    const motionEase = String(transitionObj.ease || transitionObj.type || 'ease-out');

    if (mp?.whileInView) {
      tracks.push({
        id: `${nodeId}:motion:appear`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'motion',
        trigger: 'appear',
        label: 'Motion Appear (whileInView)',
        delay: motionDelay,
        duration: motionDur,
        easing: motionEase,
        iterationCount: '1',
        stops: [
          { offset: 0, properties: mp.initial ?? {} },
          { offset: 100, properties: mp.whileInView ?? {} },
        ],
        editable: false,
      });
    }

    if (mp?.animate && !mp?.whileInView) {
      tracks.push({
        id: `${nodeId}:motion:animate`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'motion',
        trigger: transitionObj.repeat ? 'loop' : 'load',
        label: 'Motion Animate',
        delay: motionDelay,
        duration: motionDur,
        easing: motionEase,
        iterationCount: transitionObj.repeat ? String(transitionObj.repeat) : '1',
        stops: [
          { offset: 0, properties: mp.initial ?? {} },
          { offset: 100, properties: mp.animate ?? {} },
        ],
        editable: false,
      });
    }

    if (mp?.whileHover) {
      tracks.push({
        id: `${nodeId}:motion:hover`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'motion',
        trigger: 'hover',
        label: 'Motion Hover',
        delay: 0,
        duration: parseSecondsValue(transitionObj.duration, 0.25),
        easing: motionEase,
        iterationCount: '1',
        stops: [
          { offset: 0, properties: {} },
          { offset: 100, properties: mp.whileHover ?? {} },
        ],
        editable: false,
      });
    }

    if (mp?.whileTap) {
      tracks.push({
        id: `${nodeId}:motion:tap`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'motion',
        trigger: 'tap',
        label: 'Motion Tap',
        delay: 0,
        duration: parseSecondsValue(transitionObj.duration, 0.18),
        easing: motionEase,
        iterationCount: '1',
        stops: [
          { offset: 0, properties: {} },
          { offset: 100, properties: mp.whileTap ?? {} },
        ],
        editable: false,
      });
    }

    // 3d. Text animations (`data-text-anim`)
    const textAnim = getTextAnimForNode(textAnims, nodeId);
    if (textAnim) {
      const cfg = textAnim.config as any;
      const delay = parseSecondsValue(cfg.delay, 0);
      const dur = parseSecondsValue(cfg.duration, 0.6);
      tracks.push({
        id: `${nodeId}:text-anim`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'text',
        trigger: 'appear',
        label: `Text Effect (${cfg.animationType || 'split'})`,
        delay,
        duration: dur,
        easing: String(cfg.ease || 'ease-out'),
        iterationCount: '1',
        stops: [
          { offset: 0, properties: { split: cfg.splitBy || 'chars' } },
          { offset: 100, properties: { stagger: String(cfg.stagger ?? 0.03) } },
        ],
        editable: false,
      });
    }

    // 3e. Scroll-linked transforms
    const nodeScroll = getScrollDataForNode(scrollData, nodeId);
    if (nodeScroll.bindings.length > 0) {
      tracks.push({
        id: `${nodeId}:scroll`,
        scope: 'dom',
        nodeId,
        nodeName,
        nodeTag,
        pageLabel,
        kind: 'scroll',
        trigger: 'scroll',
        label: `Scroll Transform (${nodeScroll.bindings.map((b) => b.property).join(', ')})`,
        delay: 0,
        duration: 1,
        easing: 'linear (scroll)',
        iterationCount: 'scrub',
        stops: [
          { offset: 0, properties: { scroll: '0%' } },
          { offset: 100, properties: { scroll: '100%' } },
        ],
        scrollRange: [0, 100],
        editable: false,
      });
    }
  });

  return tracks;
});
