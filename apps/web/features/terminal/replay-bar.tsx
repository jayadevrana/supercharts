'use client';

import { useEffect, useRef, useState } from 'react';
import { History, Pause, Play, Rewind, FastForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useTerminalStore } from './terminal-store';

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];

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

  const stepRef = useRef<number>(60_000);

  useEffect(() => {
    if (!replayPlaying || !replayMode) return;
    const step = stepRef.current;
    const id = setInterval(() => {
      const cur = useTerminalStore.getState().replayCursor;
      const max = useTerminalStore.getState().replayBounds.to;
      if (cur >= max) {
        setReplayPlaying(false);
        return;
      }
      setReplayCursor(Math.min(max, cur + step));
    }, Math.max(80, 1000 / replaySpeed));
    return () => clearInterval(id);
  }, [replayPlaying, replayMode, replaySpeed, setReplayCursor, setReplayPlaying]);

  if (!replayMode) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-2 shadow-floating backdrop-blur">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <History className="h-3 w-3" /> replay
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() =>
            setReplayCursor(Math.max(replayBounds.from, replayCursor - stepRef.current * 10))
          }
        >
          <Rewind className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="h-7 px-2"
          onClick={() => setReplayPlaying(!replayPlaying)}
        >
          {replayPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => setReplayCursor(Math.min(replayBounds.to, replayCursor + stepRef.current * 10))}
        >
          <FastForward className="h-3 w-3" />
        </Button>

        <div className="w-[280px]">
          <Slider
            value={[Math.max(0, Math.min(1000, ((replayCursor - replayBounds.from) / Math.max(1, replayBounds.to - replayBounds.from)) * 1000))]}
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

        <div className="font-mono text-[11px] tabular-nums text-foreground">
          {new Date(replayCursor).toISOString().replace('T', ' ').slice(0, 19)}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setReplaySpeed(s)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${replaySpeed === s ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setReplayMode(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
