// AnimationTimeline.tsx — Bottom timeline panel inspecting and editing all
// DOM element and page-level animations, durations, delays, and keyframe offsets.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  timelineOpenAtom,
  timelineNumericColumnOpenAtom,
  timelineFilterAtom,
  timelinePlayheadAtom,
  timelineTracksAtom,
  type TimelineTrack,
} from '@/code/stores/timeline-store';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import {
  parseAnimationShorthand,
  formatAnimationShorthand,
  parseTransitionShorthand,
  formatTransitionShorthand,
} from '@/shared/animation-utils';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { getViewportPrefix } from '@/canvas/node-ops';
import { trace } from '@/shared/debug-trace';

const KIND_COLORS: Record<string, string> = {
  keyframe: '#f59e0b',
  transition: '#38bdf8',
  motion: '#a855f7',
  text: '#ec4899',
  scroll: '#10b981',
  'page-transition': '#6366f1',
  'smooth-scroll': '#14b8a6',
};

function roundSec(val: number): number {
  return Math.round(val * 100) / 100;
}

function TrackRow({
  track,
  maxTime,
  showNumeric,
  isSelected,
  onSelect,
  onCommitTiming,
}: {
  track: TimelineTrack;
  maxTime: number;
  showNumeric: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onCommitTiming: (track: TimelineTrack, nextDelay: number, nextDuration: number) => void;
}) {
  const [delayDraft, setDelayDraft] = useState(() => String(track.delay));
  const [durationDraft, setDurationDraft] = useState(() => String(track.duration));
  const [dragState, setDragState] = useState<{
    mode: 'move' | 'start' | 'end';
    delay: number;
    duration: number;
  } | null>(null);
  const trackLaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dragState) {
      setDelayDraft(String(track.delay));
    }
  }, [track.delay, dragState]);

  useEffect(() => {
    if (!dragState) {
      setDurationDraft(String(track.duration));
    }
  }, [track.duration, dragState]);

  const commitNumeric = () => {
    if (!track.editable) return;
    const parsedDelay = Math.max(0, Number.parseFloat(delayDraft));
    const parsedDur = Math.max(0.05, Number.parseFloat(durationDraft));
    const finalDelay = Number.isFinite(parsedDelay) ? roundSec(parsedDelay) : track.delay;
    const finalDur = Number.isFinite(parsedDur) ? roundSec(parsedDur) : track.duration;
    if (finalDelay !== track.delay || finalDur !== track.duration) {
      onCommitTiming(track, finalDelay, finalDur);
    }
  };

  const startBarDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'start' | 'end',
  ) => {
    if (!track.editable) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();

    const laneEl = trackLaneRef.current;
    if (!laneEl) return;
    const laneRect = laneEl.getBoundingClientRect();
    const laneWidth = Math.max(1, laneRect.width);
    const startX = e.clientX;
    const initialDelay = track.delay;
    const initialDuration = track.duration;
    let latestDelay = initialDelay;
    let latestDuration = initialDuration;

    setDragState({ mode, delay: initialDelay, duration: initialDuration });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const deltaSec = (dx / laneWidth) * maxTime;

      if (mode === 'move') {
        latestDelay = roundSec(Math.max(0, initialDelay + deltaSec));
        latestDuration = initialDuration;
      } else if (mode === 'start') {
        const endSec = initialDelay + initialDuration;
        const clampedStart = Math.max(0, Math.min(endSec - 0.05, initialDelay + deltaSec));
        latestDelay = roundSec(clampedStart);
        latestDuration = roundSec(Math.max(0.05, endSec - latestDelay));
      } else if (mode === 'end') {
        latestDelay = initialDelay;
        latestDuration = roundSec(Math.max(0.05, initialDuration + deltaSec));
      }

      setDragState({ mode, delay: latestDelay, duration: latestDuration });
      setDelayDraft(String(latestDelay));
      setDurationDraft(String(latestDuration));
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setDragState(null);
      if (latestDelay !== initialDelay || latestDuration !== initialDuration) {
        onCommitTiming(track, latestDelay, latestDuration);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const effectiveDelay = dragState ? dragState.delay : track.delay;
  const effectiveDuration = dragState ? dragState.duration : track.duration;

  const color = KIND_COLORS[track.kind] ?? '#f59e0b';
  const leftPct = Math.min(96, Math.max(0, (effectiveDelay / maxTime) * 100));
  const widthPct = Math.min(100 - leftPct, Math.max(2, (effectiveDuration / maxTime) * 100));

  return (
    <div
      data-testid={`timeline-row-${track.nodeId}`}
      data-track-id={track.id}
      onClick={onSelect}
      className={`grid items-center border-b border-[var(--border-light)] text-xs cursor-pointer transition-colors ${
        isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      style={{
        gridTemplateColumns: showNumeric ? '260px 210px 1fr' : '260px 1fr',
        minHeight: 38,
      }}
    >
      {/* Element / Page identity */}
      <div className="flex items-center gap-2 px-3 py-1.5 min-w-0 border-r border-[var(--border-light)]">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase shrink-0"
          style={{
            backgroundColor: track.scope === 'page' ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)',
            color: track.scope === 'page' ? '#a5b4fc' : 'var(--text-secondary)',
          }}
        >
          {track.scope === 'page' ? 'PAGE' : track.nodeTag}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[var(--text-primary)] truncate">
            {track.nodeId}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)] truncate">
            {track.label} · {track.easing}
          </div>
        </div>
        <span
          className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold shrink-0"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {track.trigger}
        </span>
      </div>

      {/* Collapsible Numeric Delay (offset) & Duration controls */}
      {showNumeric && (
        <div
          className="flex items-center gap-2 px-2.5 py-1 border-r border-[var(--border-light)] text-[11px] tabular-nums"
        >
          <label className="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span>offset</span>
            <input
              type="text"
              aria-label={`Delay for ${track.nodeId}`}
              data-testid={`timeline-input-delay-${track.nodeId}`}
              disabled={!track.editable}
              value={delayDraft}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setDelayDraft(e.target.value)}
              onBlur={commitNumeric}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  commitNumeric();
                }
              }}
              className="w-12 h-6 px-1.5 rounded bg-black/30 border border-[var(--border-light)] text-[var(--text-primary)] text-[11px] font-mono text-right focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <span>s</span>
          </label>

          <label className="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span>dur</span>
            <input
              type="text"
              aria-label={`Duration for ${track.nodeId}`}
              data-testid={`timeline-input-duration-${track.nodeId}`}
              disabled={!track.editable}
              value={durationDraft}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setDurationDraft(e.target.value)}
              onBlur={commitNumeric}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  commitNumeric();
                }
              }}
              className="w-12 h-6 px-1.5 rounded bg-black/30 border border-[var(--border-light)] text-[var(--text-primary)] text-[11px] font-mono text-right focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <span>s</span>
          </label>
        </div>
      )}

      {/* Visual Timeline Track Bar (interactive drag for offset & duration) */}
      <div className="relative h-full flex items-center px-3 overflow-hidden">
        <div ref={trackLaneRef} className="relative w-full h-6">
          {/* Delay / Offset leader line */}
          {effectiveDelay > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 border-t border-dashed border-white/25 pointer-events-none"
              style={{ left: 0, width: `${leftPct}%` }}
              title={`Start offset: ${effectiveDelay}s`}
            />
          )}

          {/* Duration bar — drag body to shift offset, drag left/right handles to trim/stretch */}
          <div
            data-testid={`timeline-bar-${track.nodeId}`}
            onPointerDown={(e) => startBarDrag(e, 'move')}
            className={`group absolute top-1 bottom-1 rounded flex items-center justify-between px-2 select-none ${
              track.editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
            }`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              backgroundColor: dragState ? `${color}55` : `${color}38`,
              border: `1px solid ${color}`,
            }}
            title={`${track.nodeId} · ${track.label} | offset ${effectiveDelay}s · duration ${effectiveDuration}s · easing ${track.easing} (drag bar to shift offset, drag edges to resize duration)`}
          >
            {/* Interactive Start Handle (left diamond / edge) */}
            {track.editable && (
              <span
                role="slider"
                aria-label={`Start offset handle for ${track.nodeId}`}
                aria-valuenow={effectiveDelay}
                data-testid={`timeline-handle-start-${track.nodeId}`}
                onPointerDown={(e) => startBarDrag(e, 'start')}
                className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 flex items-center justify-center cursor-ew-resize z-20"
                title={`Drag to adjust start offset (${effectiveDelay}s)`}
              >
                <span className="w-2 h-2 rotate-45 bg-white border border-black/70 group-hover:scale-125 transition-transform" />
              </span>
            )}

            <span className="text-[10px] font-mono text-white/95 truncate pointer-events-none">
              {effectiveDelay > 0 ? `+${effectiveDelay}s · ` : ''}{effectiveDuration}s
            </span>

            {/* Intermediate keyframe stops (excluding 0% and 100% which have interactive handles) */}
            {track.stops
              .filter((stop) => stop.offset > 0 && stop.offset < 100)
              .map((stop, sIdx) => (
                <span
                  key={sIdx}
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-white/80 border border-black/60 pointer-events-none"
                  style={{ left: `calc(${stop.offset}% - 4px)` }}
                  title={`Keyframe stop ${stop.offset}%`}
                />
              ))}

            {/* Interactive End Handle (right diamond / edge) */}
            {track.editable && (
              <span
                role="slider"
                aria-label={`Duration handle for ${track.nodeId}`}
                aria-valuenow={effectiveDuration}
                data-testid={`timeline-handle-end-${track.nodeId}`}
                onPointerDown={(e) => startBarDrag(e, 'end')}
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 flex items-center justify-center cursor-ew-resize z-20"
                title={`Drag to adjust duration (${effectiveDuration}s)`}
              >
                <span className="w-2 h-2 rotate-45 bg-white border border-black/70 group-hover:scale-125 transition-transform" />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnimationTimeline() {
  const [open, setOpen] = useAtom(timelineOpenAtom);
  const [showNumeric, setShowNumeric] = useAtom(timelineNumericColumnOpenAtom);
  const [filter, setFilter] = useAtom(timelineFilterAtom);
  const [playhead, setPlayhead] = useAtom(timelinePlayheadAtom);
  const tracks = useAtomValue(timelineTracksAtom);
  const nodes = useAtomValue(nodesAtom);
  const [selectedIds, setSelectedIds] = useAtom(selectedIdsAtom);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);

  const filteredTracks = useMemo(() => {
    if (filter === 'all') return tracks;
    if (filter === 'dom') return tracks.filter((t) => t.scope === 'dom');
    if (filter === 'page') return tracks.filter((t) => t.scope === 'page');
    if (filter === 'scroll') return tracks.filter((t) => t.trigger === 'scroll');
    return tracks;
  }, [tracks, filter]);

  const maxTime = useMemo(() => {
    let max = 1.5;
    for (const t of filteredTracks) {
      const end = t.delay + t.duration;
      if (end > max) max = end;
    }
    return Math.ceil((max + 0.25) * 4) / 4;
  }, [filteredTracks]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const step = maxTime <= 2 ? 0.25 : 0.5;
    for (let t = 0; t <= maxTime + 0.001; t += step) {
      out.push(Number(t.toFixed(2)));
    }
    return out;
  }, [maxTime]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const startMs = performance.now() - playhead * 1000;
    const step = () => {
      const elapsed = (performance.now() - startMs) / 1000;
      if (elapsed >= maxTime) {
        setPlayhead(maxTime);
        setPlaying(false);
        rafRef.current = null;
        return;
      }
      setPlayhead(Number(elapsed.toFixed(2)));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, maxTime, setPlayhead]);

  if (!open) return null;

  const handleRulerScrub = (e: React.PointerEvent) => {
    const el = rulerRef.current;
    if (!el) return;
    e.preventDefault();
    setPlaying(false);

    const updateFromClientX = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      setPlayhead(roundSec(ratio * maxTime));
    };

    updateFromClientX(e.clientX);

    const onMove = (moveEv: PointerEvent) => updateFromClientX(moveEv.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleReplayAll = () => {
    setPlayhead(0);
    setPlaying(true);
    const prefix = getViewportPrefix('desktop');
    const bridge = getCanvasBridge();
    for (const t of filteredTracks) {
      if (t.styleProp === 'animation') {
        const node = nodes.get(t.nodeId);
        const animStr = node?.styles?.animation;
        if (animStr) {
          bridge.patchStyles(t.nodeId, prefix, { animation: 'none' });
          bridge.patchStyles(t.nodeId, prefix, { animation: animStr });
        }
      }
    }
    trace.action('animation-timeline:replay-all', { count: filteredTracks.length });
  };

  const handleCommitTiming = (track: TimelineTrack, nextDelay: number, nextDuration: number) => {
    const node = nodes.get(track.nodeId);
    if (!node || !track.styleProp) return;
    const currentRaw = node.styles?.[track.styleProp] ?? '';
    if (!currentRaw) return;

    if (track.styleProp === 'animation') {
      const anims = parseAnimationShorthand(currentRaw);
      const idx = track.animIndex ?? 0;
      if (!anims[idx]) return;
      anims[idx] = { ...anims[idx], delay: nextDelay, duration: nextDuration };
      const formatted = formatAnimationShorthand(anims);
      expediteStableAtomSync();
      queueMutation({
        type: 'updateStyles',
        nodeId: track.nodeId,
        styles: { animation: formatted },
      });
      flushNow();
      trace.action('animation-timeline:update-animation', {
        nodeId: track.nodeId,
        delay: nextDelay,
        duration: nextDuration,
      });
    } else if (track.styleProp === 'transition') {
      const transitions = parseTransitionShorthand(currentRaw);
      const idx = track.animIndex ?? 0;
      if (!transitions[idx]) return;
      transitions[idx] = { ...transitions[idx], delay: nextDelay, duration: nextDuration };
      const formatted = formatTransitionShorthand(transitions);
      expediteStableAtomSync();
      queueMutation({
        type: 'updateStyles',
        nodeId: track.nodeId,
        styles: { transition: formatted },
      });
      flushNow();
      trace.action('animation-timeline:update-transition', {
        nodeId: track.nodeId,
        delay: nextDelay,
        duration: nextDuration,
      });
    }
  };

  const playheadPct = Math.min(100, Math.max(0, (playhead / maxTime) * 100));
  const timelineColOffsetPx = showNumeric ? 470 : 260;

  return (
    <section
      data-testid="animation-timeline-panel"
      aria-label="Animation Timeline"
      className="fixed z-[90] bg-[var(--bg-surface)] border-t border-[var(--border-light)] text-[var(--text-primary)] flex flex-col shadow-2xl"
      style={{
        left: 308,
        right: 260,
        bottom: 52,
        height: 290,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--border-light)] bg-black/20 shrink-0 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-semibold tracking-wide uppercase text-[var(--accent)] whitespace-nowrap shrink-0">
            Animation Timeline
          </span>
          <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap shrink-0">
            {filteredTracks.length} {filteredTracks.length === 1 ? 'track' : 'tracks'} · {maxTime.toFixed(2)}s
          </span>

          <div className="flex items-center gap-1 ml-1 shrink-0">
            {(['all', 'dom', 'page', 'scroll'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded text-[10px] uppercase font-medium cursor-pointer border-none whitespace-nowrap ${
                  filter === f
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="toggle-timeline-numeric-column"
            onClick={() => setShowNumeric((prev) => !prev)}
            title={showNumeric ? 'Hide Offset & Duration inputs' : 'Show Offset & Duration inputs'}
            className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer border-none transition-colors whitespace-nowrap shrink-0 ${
              showNumeric
                ? 'bg-white/15 text-[var(--text-primary)]'
                : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {showNumeric ? '▾ Inputs' : '▸ Inputs'}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="timeline-play-button"
            onClick={handleReplayAll}
            className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px] font-medium text-[var(--text-primary)] cursor-pointer border-none whitespace-nowrap shrink-0"
          >
            {playing ? 'Playing…' : '▶ Replay All'}
          </button>
          <span className="text-[11px] font-mono text-[var(--text-secondary)] w-12 text-right whitespace-nowrap shrink-0">
            {playhead.toFixed(2)}s
          </span>
          <button
            type="button"
            aria-label="Close Animation Timeline"
            data-testid="close-animation-timeline"
            onClick={() => setOpen(false)}
            className="w-6 h-6 rounded flex items-center justify-center bg-transparent hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-none shrink-0"
          >
            ×
          </button>
        </div>
      </div>

      {/* Column Headers + Interactive Time Ruler */}
      <div
        className="grid items-center border-b border-[var(--border-light)] bg-black/10 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] shrink-0"
        style={{
          gridTemplateColumns: showNumeric ? '260px 210px 1fr' : '260px 1fr',
          height: 26,
        }}
      >
        <div className="px-3 border-r border-[var(--border-light)]">DOM Element / Page</div>
        {showNumeric && (
          <div
            data-testid="timeline-numeric-column-header"
            className="px-2.5 border-r border-[var(--border-light)]"
          >
            Offset &amp; Duration
          </div>
        )}
        <div
          ref={rulerRef}
          onPointerDown={handleRulerScrub}
          className="relative h-full flex items-center px-3 cursor-ew-resize select-none"
          title="Click or drag to scrub playhead"
        >
          <div className="relative w-full h-full flex items-center">
            {ticks.map((t) => {
              const pct = (t / maxTime) * 100;
              return (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 flex items-center pointer-events-none"
                  style={{ left: `${pct}%` }}
                >
                  <div className="h-2 w-px bg-white/20 mr-1" />
                  <span className="text-[9px] font-mono text-[var(--text-tertiary)] select-none">
                    {t}s
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Track List */}
      <div className="relative flex-1 overflow-y-auto">
        {/* Playhead vertical line across the timeline column */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10"
          style={{ left: timelineColOffsetPx + 12, right: 12 }}
        >
          <div
            className="absolute top-0 bottom-0 w-px bg-amber-400/80"
            style={{ left: `${playheadPct}%` }}
          />
        </div>

        {filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-[var(--text-tertiary)]">
            No animations declared for this filter on the active page.
          </div>
        ) : (
          filteredTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              maxTime={maxTime}
              showNumeric={showNumeric}
              isSelected={selectedIds.includes(track.nodeId)}
              onSelect={() => {
                setSelectedIds([track.nodeId]);
                trace.action('animation-timeline:select-node', { nodeId: track.nodeId });
              }}
              onCommitTiming={handleCommitTiming}
            />
          ))
        )}
      </div>
    </section>
  );
}
