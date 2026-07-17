'use client';

import { Cog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/components/theme-provider';
import { SKINS } from '@/lib/skins';
import { DESIGNS } from '@/lib/designs';
import { useTerminalStore } from './terminal-store';

function SettingRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-raised">
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{label}</span>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/** One selectable skin card: name + bg/accent/bull/bear swatch strip. */
function SkinCard({
  id,
  label,
  preview,
  active,
  onPick,
}: {
  id: string;
  label: string;
  preview: { bg: string; accent: string; bull: string; bear: string };
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={active}
      className={`flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors ${
        active ? 'border-accent bg-surface-raised' : 'border-border hover:bg-surface-raised'
      }`}
    >
      <span className="flex h-4 overflow-hidden rounded-sm border border-border/60">
        <span className="flex-[3]" style={{ backgroundColor: preview.bg }} />
        <span className="flex-1" style={{ backgroundColor: preview.accent }} />
        <span className="flex-1" style={{ backgroundColor: preview.bull }} />
        <span className="flex-1" style={{ backgroundColor: preview.bear }} />
      </span>
      <span className={`text-[11px] leading-none ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </button>
  );
}

/**
 * Workspace settings behind the top-bar cog. Every switch is a real store flag:
 * UI chrome (rails / script dock) + active-pane chart toggles. The Theme grid
 * live-applies a skin (CSS vars + chart palette) via the theme provider.
 */
export function WorkspaceSettingsPopover() {
  const { theme, setTheme, design, setDesign } = useTheme();
  const showLeftRail = useTerminalStore((s) => s.showLeftRail);
  const setShowLeftRail = useTerminalStore((s) => s.setShowLeftRail);
  const showRightRail = useTerminalStore((s) => s.showRightRail);
  const setShowRightRail = useTerminalStore((s) => s.setShowRightRail);
  const showBottomPanel = useTerminalStore((s) => s.showBottomPanel);
  const setShowBottomPanel = useTerminalStore((s) => s.setShowBottomPanel);
  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const activePane = useTerminalStore((s) => s.panes.find((p) => p.id === s.activePaneId));
  const setPaneOverlay = useTerminalStore((s) => s.setPaneOverlay);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Workspace settings" title="Workspace settings">
          <Cog className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Design
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
          {DESIGNS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDesign(d.id)}
              aria-pressed={design === d.id}
              title={d.tagline}
              className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors ${
                design === d.id ? 'border-accent bg-surface-raised' : 'border-border hover:bg-surface-raised'
              }`}
            >
              <span className="text-sm font-semibold leading-none text-foreground">{d.specimen}</span>
              <span
                className={`text-[11px] leading-none ${design === d.id ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {d.label}
              </span>
            </button>
          ))}
        </div>
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Theme
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
          {SKINS.map((s) => (
            <SkinCard
              key={s.id}
              id={s.id}
              label={s.label}
              preview={s.preview}
              active={theme === s.id}
              onPick={setTheme}
            />
          ))}
        </div>
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace
        </div>
        <SettingRow label="Drawing toolbar" hint="Left rail" checked={showLeftRail} onChange={setShowLeftRail} />
        <SettingRow label="Side panel" hint="Trade · indicators · data · news" checked={showRightRail} onChange={setShowRightRail} />
        <SettingRow label="Script dock" hint="PulseScript editor + strategy tester" checked={showBottomPanel} onChange={setShowBottomPanel} />
        {activePane ? (
          <>
            <div className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Active pane · {activePane.symbol.split(':')[1] ?? activePane.symbol}
            </div>
            <SettingRow
              label="Buy/Sell buttons"
              hint="Only shown while a real order book streams"
              checked={activePane.overlays.tradeButtons !== false}
              onChange={(v) => setPaneOverlay(activePaneId, 'tradeButtons', v)}
            />
            <SettingRow
              label="MA signal labels"
              hint="BUY/SELL marks from a matching alert"
              checked={activePane.overlays.maSignals}
              onChange={(v) => setPaneOverlay(activePaneId, 'maSignals', v)}
            />
            <SettingRow
              label="Volume"
              hint="Bottom volume band"
              checked={activePane.overlays.volume}
              onChange={(v) => setPaneOverlay(activePaneId, 'volume', v)}
            />
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
