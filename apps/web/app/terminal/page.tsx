'use client';

import { useEffect } from 'react';
import { TerminalTopBar } from '@/features/terminal/terminal-top-bar';
import { LeftRail } from '@/features/terminal/left-rail';
import { RightRail } from '@/features/terminal/right-rail';
import { ChartGrid } from '@/features/terminal/chart-grid';
import { PulseEditorPanel } from '@/features/terminal/pulse-editor-panel';
import { ReplayBar } from '@/features/terminal/replay-bar';
import { useTerminalStore } from '@/features/terminal/terminal-store';
import { useMT5Store } from '@/features/terminal/mt5-store';
import { getWSClient } from '@/lib/ws-client';

export default function TerminalPage() {
  const { showLeftRail, showRightRail } = useTerminalStore();
  const ingestMT5 = useMT5Store((s) => s.ingestEvent);
  const refreshAccounts = useMT5Store((s) => s.refreshAccounts);
  const refreshPositions = useMT5Store((s) => s.refreshPositions);

  // Docs deep link: /terminal?pulse=<base64url(code)> loads the snippet into the Script dock
  // (one-shot, then stripped from the URL so refresh doesn't re-apply it).
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get('pulse');
    if (!encoded) return;
    try {
      const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const code = new TextDecoder().decode(bytes);
      const s = useTerminalStore.getState();
      s.setPulseSource(s.activePaneId, code);
      s.setShowBottomPanel(true);
    } catch {
      /* malformed param — ignore, never crash the terminal */
    }
    window.history.replaceState(null, '', '/terminal');
  }, []);

  useEffect(() => {
    const ws = getWSClient();
    void refreshAccounts();
    void refreshPositions();
    const off = ws.onMT5((event) => ingestMT5(event));
    const id = setInterval(() => {
      void refreshPositions();
    }, 10_000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [ingestMT5, refreshAccounts, refreshPositions]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TerminalTopBar />
      <div className="relative flex min-h-0 flex-1">
        {showLeftRail ? <LeftRail /> : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChartGrid />
          <PulseEditorPanel />
        </main>
        {showRightRail ? <RightRail /> : null}
        <ReplayBar />
      </div>
    </div>
  );
}
