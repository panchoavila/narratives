// timeline-snap.ts — 1D temporal smart guides solver for the Animation Timeline.
//
// Computes magnetic snapping and visual smart guides when dragging a track bar
// ('move') or trimming its start/end handles ('start' | 'end'):
//   1. Edge & keyframe stop alignment (start, end, intermediate stops, playhead, ruler ticks)
//   2. Equal duration matching (when resizing start/end handle matches another track's duration)
//   3. Equal stagger / cadence detection (when moving a track's offset continues an equal step Δt)

import type { TimelineTrack } from '@/code/stores/timeline-store';

export interface TimelineGuideLine {
  time: number;          // seconds (0..maxTime)
  label: string;         // e.g. "0.12s · trending start"
  targetTrackId?: string;
  targetNodeId?: string;
  edge: 'start' | 'end';
}

export interface TimelineDurationGuide {
  duration: number;
  referenceTrackId: string;
  referenceNodeId: string;
}

export interface TimelineStaggerGuide {
  step: number;
  snappedDelay: number;
  prevNodeId: string;
  nextNodeId: string;
}

export interface TimelineSnapResult {
  delay: number;
  duration: number;
  guideLines: TimelineGuideLine[];
  durationGuide: TimelineDurationGuide | null;
  staggerGuide: TimelineStaggerGuide | null;
}

interface TimeCandidate {
  time: number;
  label: string;
  trackId?: string;
  nodeId?: string;
  priority: number; // lower = higher priority when distances tie (track edges beat ruler ticks)
}

export function roundSec(val: number): number {
  return Math.round(val * 100) / 100;
}

export function computeTimelineSnap({
  activeTrack,
  otherTracks,
  mode,
  rawDelay,
  rawDuration,
  maxTime,
  laneWidthPx,
  playhead,
  ticks,
  altKey = false,
  snapThresholdPx = 7,
}: {
  activeTrack: TimelineTrack;
  otherTracks: readonly TimelineTrack[];
  mode: 'move' | 'start' | 'end';
  rawDelay: number;
  rawDuration: number;
  maxTime: number;
  laneWidthPx: number;
  playhead: number;
  ticks: readonly number[];
  altKey?: boolean;
  snapThresholdPx?: number;
}): TimelineSnapResult {
  const baseDelay = roundSec(Math.max(0, rawDelay));
  const baseDuration = roundSec(Math.max(0.05, rawDuration));

  if (altKey || laneWidthPx <= 0 || maxTime <= 0) {
    return {
      delay: baseDelay,
      duration: baseDuration,
      guideLines: [],
      durationGuide: null,
      staggerGuide: null,
    };
  }

  const thresholdSec = (snapThresholdPx / laneWidthPx) * maxTime;

  // 1. Collect time alignment candidates
  const candidates: TimeCandidate[] = [];

  for (const other of otherTracks) {
    if (other.id === activeTrack.id) continue;
    const startT = roundSec(other.delay);
    const endT = roundSec(other.delay + other.duration);

    candidates.push({
      time: startT,
      label: `${startT}s · ${other.nodeId} start`,
      trackId: other.id,
      nodeId: other.nodeId,
      priority: 1,
    });
    candidates.push({
      time: endT,
      label: `${endT}s · ${other.nodeId} end`,
      trackId: other.id,
      nodeId: other.nodeId,
      priority: 1,
    });

    for (const stop of other.stops) {
      if (stop.offset > 0 && stop.offset < 100) {
        const stopT = roundSec(other.delay + other.duration * (stop.offset / 100));
        candidates.push({
          time: stopT,
          label: `${stopT}s · ${other.nodeId} (${stop.offset}%)`,
          trackId: other.id,
          nodeId: other.nodeId,
          priority: 2,
        });
      }
    }
  }

  if (playhead > 0) {
    const phT = roundSec(playhead);
    candidates.push({
      time: phT,
      label: `${phT}s · playhead`,
      priority: 2,
    });
  }

  for (const tick of ticks) {
    candidates.push({
      time: roundSec(tick),
      label: `${roundSec(tick)}s`,
      priority: 3,
    });
  }

  let finalDelay = baseDelay;
  let finalDuration = baseDuration;
  const guideLines: TimelineGuideLine[] = [];
  let durationGuide: TimelineDurationGuide | null = null;
  let staggerGuide: TimelineStaggerGuide | null = null;

  if (mode === 'move') {
    const rawStart = rawDelay;
    const rawEnd = rawDelay + activeTrack.duration;

    let bestDist = thresholdSec + 1;
    let bestCand: TimeCandidate | null = null;
    let bestEdge: 'start' | 'end' = 'start';

    for (const cand of candidates) {
      const distStart = Math.abs(rawStart - cand.time);
      if (
        distStart <= thresholdSec &&
        (distStart < bestDist - 1e-6 ||
          (Math.abs(distStart - bestDist) <= 1e-6 && cand.priority < (bestCand?.priority ?? 99)))
      ) {
        bestDist = distStart;
        bestCand = cand;
        bestEdge = 'start';
      }

      const distEnd = Math.abs(rawEnd - cand.time);
      if (
        distEnd <= thresholdSec &&
        (distEnd < bestDist - 1e-6 ||
          (Math.abs(distEnd - bestDist) <= 1e-6 && cand.priority < (bestCand?.priority ?? 99)))
      ) {
        bestDist = distEnd;
        bestCand = cand;
        bestEdge = 'end';
      }
    }

    // Also check Equal Stagger / Cadence among other tracks' start offsets
    const uniqueStarts = [...otherTracks]
      .filter((t) => t.id !== activeTrack.id)
      .map((t) => ({ delay: roundSec(t.delay), nodeId: t.nodeId, id: t.id }))
      .sort((a, b) => a.delay - b.delay);

    let bestStaggerDist = thresholdSec + 1;
    let matchedStagger: TimelineStaggerGuide | null = null;

    for (let i = 0; i < uniqueStarts.length - 1; i++) {
      const a = uniqueStarts[i];
      const b = uniqueStarts[i + 1];
      const step = roundSec(b.delay - a.delay);
      if (step < 0.02) continue;

      const afterTarget = roundSec(b.delay + step);
      const distAfter = Math.abs(rawStart - afterTarget);
      if (distAfter <= thresholdSec && distAfter < bestStaggerDist) {
        bestStaggerDist = distAfter;
        matchedStagger = {
          step,
          snappedDelay: afterTarget,
          prevNodeId: a.nodeId,
          nextNodeId: b.nodeId,
        };
      }

      const beforeTarget = roundSec(a.delay - step);
      if (beforeTarget >= 0) {
        const distBefore = Math.abs(rawStart - beforeTarget);
        if (distBefore <= thresholdSec && distBefore < bestStaggerDist) {
          bestStaggerDist = distBefore;
          matchedStagger = {
            step,
            snappedDelay: beforeTarget,
            prevNodeId: a.nodeId,
            nextNodeId: b.nodeId,
          };
        }
      }
    }

    if (bestCand && bestDist <= bestStaggerDist) {
      if (bestEdge === 'start') {
        finalDelay = roundSec(Math.max(0, bestCand.time));
      } else {
        finalDelay = roundSec(Math.max(0, bestCand.time - activeTrack.duration));
      }
      guideLines.push({
        time: bestCand.time,
        label: bestCand.label,
        targetTrackId: bestCand.trackId,
        targetNodeId: bestCand.nodeId,
        edge: bestEdge,
      });
    } else if (matchedStagger) {
      finalDelay = matchedStagger.snappedDelay;
      staggerGuide = matchedStagger;
      guideLines.push({
        time: finalDelay,
        label: `${finalDelay}s · stagger Δ+${matchedStagger.step}s`,
        edge: 'start',
      });
    }
  } else if (mode === 'start') {
    const fixedEnd = roundSec(activeTrack.delay + activeTrack.duration);
    let bestDist = thresholdSec + 1;
    let bestCand: TimeCandidate | null = null;

    for (const cand of candidates) {
      if (cand.time > fixedEnd - 0.05) continue;
      const dist = Math.abs(rawDelay - cand.time);
      if (
        dist <= thresholdSec &&
        (dist < bestDist - 1e-6 ||
          (Math.abs(dist - bestDist) <= 1e-6 && cand.priority < (bestCand?.priority ?? 99)))
      ) {
        bestDist = dist;
        bestCand = cand;
      }
    }

    if (bestCand) {
      finalDelay = roundSec(Math.max(0, bestCand.time));
      finalDuration = roundSec(Math.max(0.05, fixedEnd - finalDelay));
      guideLines.push({
        time: bestCand.time,
        label: bestCand.label,
        targetTrackId: bestCand.trackId,
        targetNodeId: bestCand.nodeId,
        edge: 'start',
      });
    }
  } else if (mode === 'end') {
    const rawEnd = activeTrack.delay + rawDuration;
    let bestDist = thresholdSec + 1;
    let bestCand: TimeCandidate | null = null;

    for (const cand of candidates) {
      if (cand.time < activeTrack.delay + 0.05) continue;
      const dist = Math.abs(rawEnd - cand.time);
      if (
        dist <= thresholdSec &&
        (dist < bestDist - 1e-6 ||
          (Math.abs(dist - bestDist) <= 1e-6 && cand.priority < (bestCand?.priority ?? 99)))
      ) {
        bestDist = dist;
        bestCand = cand;
      }
    }

    // Also check Equal Duration against other tracks
    let bestDurDist = thresholdSec + 1;
    let matchedDurTrack: TimelineTrack | null = null;
    for (const other of otherTracks) {
      if (other.id === activeTrack.id) continue;
      const dist = Math.abs(rawDuration - other.duration);
      if (dist <= thresholdSec && dist < bestDurDist) {
        bestDurDist = dist;
        matchedDurTrack = other;
      }
    }

    if (bestCand && bestDist <= bestDurDist) {
      finalDuration = roundSec(Math.max(0.05, bestCand.time - activeTrack.delay));
      guideLines.push({
        time: bestCand.time,
        label: bestCand.label,
        targetTrackId: bestCand.trackId,
        targetNodeId: bestCand.nodeId,
        edge: 'end',
      });
    } else if (matchedDurTrack) {
      finalDuration = roundSec(matchedDurTrack.duration);
      durationGuide = {
        duration: finalDuration,
        referenceTrackId: matchedDurTrack.id,
        referenceNodeId: matchedDurTrack.nodeId,
      };
      const endTime = roundSec(activeTrack.delay + finalDuration);
      guideLines.push({
        time: endTime,
        label: `= ${finalDuration}s (${matchedDurTrack.nodeId})`,
        targetTrackId: matchedDurTrack.id,
        targetNodeId: matchedDurTrack.nodeId,
        edge: 'end',
      });
    }
  }

  // Check if snapped duration also happens to match another track's duration
  if (!durationGuide) {
    for (const other of otherTracks) {
      if (other.id === activeTrack.id) continue;
      if (Math.abs(finalDuration - other.duration) < 0.005) {
        durationGuide = {
          duration: finalDuration,
          referenceTrackId: other.id,
          referenceNodeId: other.nodeId,
        };
        break;
      }
    }
  }

  return {
    delay: finalDelay,
    duration: finalDuration,
    guideLines,
    durationGuide,
    staggerGuide,
  };
}
