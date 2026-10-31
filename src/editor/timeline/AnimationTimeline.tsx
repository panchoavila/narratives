// AnimationTimeline.tsx — Bottom timeline panel inspecting and editing all
// DOM element and page-level animations, durations, delays, and keyframe offsets.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  timelineOpenAtom,
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

function TrackRow({
  track,
  maxTime,
  isSelected,
  onSelect,
  onCommitTiming,
}: {
  track: TimelineTrack;
  maxTime: number;
  isSelected: boolean;
  onSelect: () => void;
  onCommitTiming: (track: TimelineTrack, nextDelay: number, nextDuration: number) => void;
}) {
  const [delayDraft, setDelayDraft] = useState(() => String(track.delay));
  const [durationDraft, setDurationDraft] = useState(() => String(track.duration));

  useEffect(() => {
    setDelayDraft(String(track.delay));
  }, [track.delay]);

  useEffect(() => {
    setDurationDraft(String(track.duration));
  }, [track.duration]);

  const commit = () => {
    if (!track.editable) return;
    const parsedDelay = Math.max(0, Number.parseFloat(delayDraft));
    const parsedDur = Math.max(0.05, Number.parseFloat(durationDraft));
    const finalDelay = Number.isFinite(parsedDelay) ? Number(parsedDelay.toFixed(3)) : track.delay;
    const finalDur = Number.isFinite(parsedDur) ? Number(parsedDur.toFixed(3)) : track.duration;
    if (finalDelay !== track.delay || finalDur !== track.duration) {
      onCommitTiming(track, finalDelay, finalDur);
    }
  };

  const color = KIND_COLORS[track.kind] ?? '#f59e0b';
  const leftPct = Math.min(96, Math.max(0, (track.delay / maxTime) * 100));
  const widthPct = Math.min(100 - leftPct, Math.max(2, (track.duration / maxTime) * 100));

  return (
    <div
      data-testid={`timeline-row-${track.nodeId}`}
      data-track-id={track.id}
      onClick={onSelect}
      className={`grid items-center border-b border-[var(--border-light)] text-xs cursor-pointer transition-colors ${
        isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      style={{ gridTemplateColumns: '260px 210px 1fr', minHeight: 38 }}
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

      {/* Numeric Delay (offset) & Duration controls */}
      <div
        className="flex items-center gap-2 px-2.5 py-1 border-r border-[var(--border-light)] text-[11px] tabular-nums"
      >
        <label className="flex items-center gap-1 text-[var(--text-tertiary)]">
          <span> offset</span>
          <input
            type="text"
            aria-label={`Delay for ${track.nodeId}`}
            data-testid={`timeline-input-delay-${track.nodeId}`}
            disabled={!track.editable}
            value={delayDraft}
            onChange={(e) => setDelayDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
                commit();
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
            onChange={(e) => setDurationDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
                commit();
              }
            }}
            className="w-12 h-6 px-1.5 rounded bg-black/30 border border-[var(--border-light)] text-[var(--text-primary)] text-[11px] font-mono text-right focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
          />
          <span>s</span>
        </label>
      </div>

      {/* Visual Timeline Track Bar */}
      <div className="relative h-full flex items-center px-3 overflow-hidden">
        <div className="relative w-full h-6">
          {/* Delay / Offset leader line */}
          {track.delay > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 border-t border-dashed border-white/25 pointer-events-none"
              style={{ left: 0, width: `${leftPct}%` }}
              title={`Start offset: ${track.delay}s`}
            />
          )}

          {/* Duration bar */}
          <div
            data-testid={`timeline-bar-${track.nodeId}`}
            className="absolute top-1 bottom-1 rounded flex items-center justify-between px-1.5 select-none"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              backgroundColor: `${color}38`,
              border: `1px solid ${color}`,
            }}
            title={`${track.nodeId} · ${track.label} | offset ${track.delay}s · duration ${track.duration}s · easing ${track.easing}`}
          >
            <span className="text-[10px] font-mono text-white/90 truncate">
              {track.delay > 0 ? `+${track.delay}s · ` : ''}{track.duration}s
            </span>

            {/* Keyframe / stop offset markers inside the bar */}
            {track.stops.map((stop, sIdx) => (
              <span
                key={sIdx}
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-white border border-black/60 pointer-events-none"
                style={{ left: `calc(${stop.offset}% - 4px)` }}
                title={`Stop ${stop.offset}%`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnimationTimeline() {
  const [open, setOpen] = useAtom(timelineOpenAtom);
  const [filter, setFilter] = useAtom(timelineFilterAtom);
  const [playhead, setPlayhead] = useAtom(timelinePlayheadAtom);
  const tracks = useAtomValue(timelineTracksAtom);
  const nodes = useAtomValue(nodesAtom);
  const [selectedIds, setSelectedIds] = useAtom(selectedIdsAtom);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);

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
    return Math.ceil(max * 4) / 4;
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
      <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--border-light)] bg-black/20 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase text-[var(--accent)]">
            Animation Timeline
          </span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {filteredTracks.length} {filteredTracks.length === 1 ? 'track' : 'tracks'} · span {maxTime.toFixed(2)}s
          </span>

          <div className="flex items-center gap-1 ml-2">
            {(['all', 'dom', 'page', 'scroll'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded text-[10px] uppercase font-medium cursor-pointer border-none ${
                  filter === f
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="timeline-play-button"
            onClick={handleReplayAll}
            className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px] font-medium text-[var(--text-primary)] cursor-pointer border-none"
          >
            {playing ? 'Playing…' : '▶ Replay All'}
          </button>
          <span className="text-[11px] font-mono text-[var(--text-secondary)] w-12 text-right">
            {playhead.toFixed(2)}s
          </span>
          <button
            type="button"
            aria-label="Close Animation Timeline"
            data-testid="close-animation-timeline"
            onClick={() => setOpen(false)}
            className="w-6 h-6 rounded flex items-center justify-center bg-transparent hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Column Headers + Time Ruler */}
      <div
        className="grid items-center border-b border-[var(--border-light)] bg-black/10 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] shrink-0"
        style={{ gridTemplateColumns: '260px 210px 1fr', height: 26 }}
      >
        <div className="px-3 border-r border-[var(--border-light)]">DOM Element / Page</div>
        <div className="px-2.5 border-r border-[var(--border-light)]">Offset &amp; Duration</div>
        <div className="relative h-full flex items-center px-3">
          <div className="relative w-full h-full flex items-center">
            {ticks.map((t) => {
              const pct = (t / maxTime) * 100;
              return (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 flex items-center"
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
          style={{ left: 470, right: 12 }}
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
