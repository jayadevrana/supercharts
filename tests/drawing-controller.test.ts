import { describe, expect, it, vi } from 'vitest';
import { DrawingController, type DrawingDraftHandler } from '../apps/web/features/terminal/drawing-controller';
import type { DrawingObject } from '@supercharts/types';
import type { ChartCore, ChartPointerEvent } from '@supercharts/chart-core';

/** Minimal ChartCore stand-in: the controller only touches `opts.onPointerEvent` and `setDrawings`. */
function stubCore() {
  const pushes: DrawingObject[][] = [];
  const core = {
    opts: {} as { onPointerEvent?: (e: ChartPointerEvent) => void },
    setDrawings: (d: DrawingObject[]) => {
      pushes.push(d.map((x) => ({ ...x })));
    },
  };
  return { core: core as unknown as ChartCore, raw: core, pushes };
}

function ev(type: string, time: number, price: number, x = 0, y = 0): ChartPointerEvent {
  return { type, time, price, x, y } as unknown as ChartPointerEvent;
}

function makeController(opts: {
  tool?: string | null;
  magnet?: boolean;
  locked?: boolean;
  hidden?: boolean;
  snapPoint?: (t: number, p: number) => { time: number; price: number };
  handlers?: Partial<DrawingDraftHandler>;
  initial?: DrawingObject[];
}) {
  const { core, raw, pushes } = stubCore();
  let tool = opts.tool ?? null;
  const handlers: DrawingDraftHandler = {
    onCreate: opts.handlers?.onCreate ?? vi.fn(),
    onUpdate: opts.handlers?.onUpdate ?? vi.fn(),
    onDelete: opts.handlers?.onDelete ?? vi.fn(),
  };
  const controller = new DrawingController({
    core,
    symbol: 'BINANCE:TESTUSDT',
    userId: 'demo',
    getTool: () => tool,
    clearTool: () => {
      tool = null;
    },
    handlers,
    initial: opts.initial ?? [],
    getMagnet: () => opts.magnet ?? false,
    getLocked: () => opts.locked ?? false,
    getHidden: () => opts.hidden ?? false,
    snapPoint: opts.snapPoint,
  });
  const fire = (e: ChartPointerEvent) => raw.opts.onPointerEvent!(e);
  return { controller, fire, pushes, handlers, setTool: (t: string | null) => (tool = t) };
}

function existingLine(): DrawingObject {
  return {
    id: 'local-1',
    userId: 'demo',
    symbol: 'BINANCE:TESTUSDT',
    type: 'trend_line',
    points: [
      { time: 60_000, price: 100 },
      { time: 120_000, price: 110 },
    ],
    style: { strokeColor: '#fff', strokeWidth: 1 },
    locked: false,
    visible: true,
    zIndex: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('DrawingController meta modes', () => {
  it('creates a trend line by drag and reports it', () => {
    const onCreate = vi.fn();
    const { fire, handlers } = makeController({ tool: 'trend_line', handlers: { onCreate } });
    fire(ev('pointerdown', 60_000, 100, 10, 10));
    fire(ev('pointermove', 90_000, 105, 60, 40));
    fire(ev('pointerup', 120_000, 110, 100, 80)); // travel > 6px → drag-finalize
    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
    const created = onCreate.mock.calls[0]![0] as DrawingObject;
    expect(created.points).toEqual([
      { time: 60_000, price: 100 },
      { time: 120_000, price: 110 },
    ]);
  });

  it('magnet snaps captured points through snapPoint', () => {
    const onCreate = vi.fn();
    const { fire } = makeController({
      tool: 'trend_line',
      magnet: true,
      snapPoint: (t) => ({ time: Math.round(t / 60_000) * 60_000, price: 42 }),
      handlers: { onCreate },
    });
    fire(ev('pointerdown', 61_000, 100.7, 10, 10));
    fire(ev('pointerup', 119_000, 108.2, 100, 80));
    const created = onCreate.mock.calls[0]![0] as DrawingObject;
    expect(created.points).toEqual([
      { time: 60_000, price: 42 },
      { time: 120_000, price: 42 },
    ]);
  });

  it('unlocked: dragging an endpoint moves it and fires onUpdate on release', () => {
    const onUpdate = vi.fn();
    const { fire } = makeController({ initial: [existingLine()], handlers: { onUpdate } });
    fire(ev('pointerdown', 120_000, 110, 100, 80)); // grab endpoint handle
    fire(ev('pointermove', 180_000, 130, 150, 20));
    fire(ev('pointerup', 180_000, 130, 150, 20));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0]![0] as DrawingObject;
    expect(updated.points[1]).toEqual({ time: 180_000, price: 130 });
  });

  it('locked: the same drag selects nothing, moves nothing, never calls onUpdate', () => {
    const onUpdate = vi.fn();
    const { fire, pushes } = makeController({ initial: [existingLine()], locked: true, handlers: { onUpdate } });
    const pushesBefore = pushes.length;
    fire(ev('pointerdown', 120_000, 110, 100, 80));
    fire(ev('pointermove', 180_000, 130, 150, 20));
    fire(ev('pointerup', 180_000, 130, 150, 20));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(pushes.length).toBe(pushesBefore); // no re-render pushes from a blocked drag
  });

  it('hidden: pushes an empty set and blocks creation', () => {
    const onCreate = vi.fn();
    const { fire, pushes, controller } = makeController({
      tool: 'horizontal_line',
      hidden: true,
      initial: [existingLine()],
      handlers: { onCreate },
    });
    expect(pushes[pushes.length - 1]).toEqual([]); // constructor push honors hidden
    fire(ev('pointerdown', 60_000, 100, 10, 10));
    expect(onCreate).not.toHaveBeenCalled();
    controller.refreshVisibility();
    expect(pushes[pushes.length - 1]).toEqual([]);
  });

  it('clearAll deletes every drawing and empties the layer', () => {
    const onDelete = vi.fn();
    const { controller, pushes } = makeController({ initial: [existingLine()], handlers: { onDelete } });
    controller.clearAll();
    expect(onDelete).toHaveBeenCalledWith('local-1');
    expect(pushes[pushes.length - 1]).toEqual([]);
  });

  it('adopts the server id returned by onCreate so later deletes hit the persisted row', async () => {
    const onDelete = vi.fn();
    const { fire, controller } = makeController({
      tool: 'horizontal_line',
      handlers: { onCreate: () => Promise.resolve('server-9'), onDelete },
    });
    fire(ev('pointerdown', 60_000, 100, 10, 10));
    await Promise.resolve(); // let the id-adoption microtask run
    await Promise.resolve();
    controller.clearAll();
    expect(onDelete).toHaveBeenCalledWith('server-9');
  });
});
