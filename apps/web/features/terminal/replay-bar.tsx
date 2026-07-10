'use client';

import { useEffect } from 'react';
import { History, Pause, Play, StepBack, StepForward, X } from 'lucide-react';
import { INTERVAL_MS } from '@supercharts/types';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useTerminalStore } from './terminal-store';

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];

function clampReplayCursor(value: number, from: number, to: number) {
  return Math.max(from, Math.min(to, value));
}

function formatReplayTime(time: number) {
  return new Date(time).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Floating bar replay control. When active, every pane clips its visible
 * candles to `replayCursor` (a UNIX ms cap). The cursor moves by one
 * "step" — the active pane's interval — at the chosen speed.
 */
export function ReplayBar() {
  const replayMode = useTerminalStore((s) => s.replayMode);
  const replayCursor = useTerminalStore((s) => s.replayCursor);
  const replayPlaying = useTerminalStore((s) => s.replayPlaying);
  const replaySpeed = useTerminalStore((s) => s.replaySpeed);
  const replayBounds = useTerminalStore((s) => s.replayBounds);
  const setReplayMode = useTerminalStore((s) => s.setReplayMode);
  const setReplayCursor = useTerminalStore((s) => s.setReplayCursor);
  const setReplayPlaying = useTerminalStore((s) => s.setReplayPlaying);
  const setReplaySpeed = useTerminalStore((s) => s.setReplaySpeed);
  const activeInterval = useTerminalStore(
    (s) => s.panes.find((p) => p.id === s.activePaneId)?.interval ?? '1m',
  );

  // One step = one bar of the ACTIVE pane's interval ('tick' maps to 0 → fall back to 1m).
  const stepMs = INTERVAL_MS[activeInterval] || 60_000;

  const range = Math.max(1, replayBounds.to - replayBounds.from);
  const progress = Math.max(0, Math.min(1000, ((replayCursor - replayBounds.from) / range) * 1000));
  const atStart = replayCursor <= replayBounds.from;
  const atLiveEdge = replayCursor >= replayBounds.to;
  const statusLabel = replayPlaying && !atLiveEdge ? 'Playing' : 'Paused';
  const modeLabel = atLiveEdge ? 'Live edge' : 'Replay';
  const formattedReplaySpeed = `${replaySpeed}×`;
  const formattedReplayTime = formatReplayTime(replayCursor);
  const stepCursor = (delta: number) => {
    setReplayCursor(clampReplayCursor(replayCursor + delta, replayBounds.from, replayBounds.to));
  };

  useEffect(() => {
    if (!replayPlaying || !replayMode) return;
    const id = setInterval(() => {
      const cur = useTerminalStore.getState().replayCursor;
      const max = useTerminalStore.getState().replayBounds.to;
      if (cur >= max) {
        setReplayPlaying(false);
        return;
      }
      setReplayCursor(Math.min(max, cur + stepMs));
    }, Math.max(80, 1000 / replaySpeed));
    return () => clearInterval(id);
  }, [replayPlaying, replayMode, replaySpeed, stepMs, setReplayCursor, setReplayPlaying]);

  if (!replayMode) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Bar replay controls"
        className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-floating backdrop-blur"
      >
        <div
          className="flex h-7 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 text-[10px] font-semibold uppercase text-accent"
          aria-label={`Replay status: ${modeLabel}, ${statusLabel}`}
          aria-live="polite"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${replayPlaying ? 'bg-bull' : 'bg-accent'}`} />
          <History className="h-3 w-3" aria-hidden="true" />
          <span>{modeLabel}</span>
          <span className="text-muted-foreground">{statusLabel}</span>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-raised/40 p-0.5" aria-label="Replay step controls">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-7 gap-1 px-2"
            disabled={atStart}
            title="Step back 1 bar"
            aria-label="Step back 1 bar"
            onClick={() => stepCursor(-stepMs)}
          >
            <StepBack className="h-3 w-3" aria-hidden="true" />
            <span className="text-[10px]">1 bar</span>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="primary"
            className="h-7 min-w-[4rem] gap-1 px-2.5"
            title={replayPlaying ? 'Pause replay' : 'Play replay'}
            aria-label={replayPlaying ? 'Pause replay' : 'Play replay'}
            aria-pressed={replayPlaying}
            onClick={() => setReplayPlaying(!replayPlaying)}
          >
            {replayPlaying ? (
              <Pause className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Play className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="text-[10px]">{replayPlaying ? 'Pause' : 'Play'}</span>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-7 gap-1 px-2"
            disabled={atLiveEdge}
            title="Step forward 1 bar"
            aria-label="Step forward 1 bar"
            onClick={() => stepCursor(stepMs)}
          >
            <span className="text-[10px]">1 bar</span>
            <StepForward className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-w-[220px] items-center gap-2">
          <div className="w-36 sm:w-[260px]">
            <Slider
              aria-label="Replay progress"
              value={[progress]}
              min={0}
              max={1000}
              step={1}
              onValueChange={(v) => {
                const ratio = (v[0] ?? 0) / 1000;
                const next = replayBounds.from + ratio * (replayBounds.to - replayBounds.from);
                setReplayCursor(Math.floor(next));
              }}
            />
          </div>

          <div className="min-w-[132px] font-mono text-[11px] tabular-nums text-foreground" title={formattedReplayTime}>
            {formattedReplayTime}
          </div>
        </div>

        <div
          className="flex items-center gap-1 rounded-md border border-border bg-surface-raised/40 p-0.5"
          aria-label={`Replay speed, current ${formattedReplaySpeed}`}
        >
          <span className="px-1 text-[10px] font-semibold uppercase text-muted-foreground">Speed</span>
          {SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              aria-label={`Set replay speed to ${s} times`}
              aria-pressed={replaySpeed === s}
              title={`Replay speed ${s}×`}
              onClick={() => setReplaySpeed(s)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent/50 ${
                replaySpeed === s ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[10px] uppercase"
          title="Exit replay and return to live chart"
          aria-label="Exit replay and return to live chart"
          onClick={() => setReplayMode(false)}
        >
          <span>Live</span>
          <X className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
