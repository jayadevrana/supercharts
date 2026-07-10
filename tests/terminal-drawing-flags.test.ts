import { describe, expect, it } from 'vitest';
import { useTerminalStore } from '../apps/web/features/terminal/terminal-store';

describe('terminal store drawing flags', () => {
  it('defaults magnet/lock/hide off and toggles each independently', () => {
    const s = useTerminalStore.getState();
    expect(s.magnetSnap).toBe(false);
    expect(s.drawingsLocked).toBe(false);
    expect(s.drawingsHidden).toBe(false);

    s.toggleMagnetSnap();
    s.toggleDrawingsLocked();
    expect(useTerminalStore.getState().magnetSnap).toBe(true);
    expect(useTerminalStore.getState().drawingsLocked).toBe(true);
    expect(useTerminalStore.getState().drawingsHidden).toBe(false);

    useTerminalStore.getState().toggleMagnetSnap();
    useTerminalStore.getState().toggleDrawingsLocked();
    expect(useTerminalStore.getState().magnetSnap).toBe(false);
    expect(useTerminalStore.getState().drawingsLocked).toBe(false);
  });

  it('bumps the clear-drawings request token on every request', () => {
    expect(useTerminalStore.getState().clearDrawingsRequest).toBeNull();
    useTerminalStore.getState().requestClearDrawings();
    const first = useTerminalStore.getState().clearDrawingsRequest;
    expect(first?.token).toBe(1);
    useTerminalStore.getState().requestClearDrawings();
    expect(useTerminalStore.getState().clearDrawingsRequest?.token).toBe(2);
  });
});
