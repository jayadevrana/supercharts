import { describe, it, expect } from 'vitest';
import { finalizeFootprintBar } from '../apps/ingestion/src/footprint-aggregator';

function cell(priceLevel: number, bid: number, ask: number) {
  return {
    candleOpenTime: 0,
    priceLevel,
    bidVolume: bid,
    askVolume: ask,
    delta: 0,
    totalVolume: 0,
    imbalanceSide: 'none' as const,
    imbalanceRatio: 0,
    absorptionFlag: false,
    stackedImbalanceFlag: false,
  };
}
function bar(cells: ReturnType<typeof cell>[]) {
  return {
    symbol: 'T',
    interval: '1m' as const,
    openTime: 0,
    closeTime: 60_000,
    cells,
    candleDelta: 0,
    candleVolume: 0,
    candlePOC: 0,
    bidVolumeTotal: 0,
    askVolumeTotal: 0,
  };
}

describe('finalizeFootprintBar', () => {
  it('classifies per-cell imbalance and rolls up totals / POC', () => {
    const b = finalizeFootprintBar(
      bar([cell(100, 10, 40), cell(101, 50, 5), cell(102, 10, 12)]),
      { imbalanceRatio: 3 },
    );
    expect(b.cells[0]!.imbalanceSide).toBe('buy'); // ask 40 ≥ bid 10 ×3
    expect(b.cells[1]!.imbalanceSide).toBe('sell'); // bid 50 ≥ ask 5 ×3
    expect(b.cells[2]!.imbalanceSide).toBe('none'); // neither side dominates
    expect(b.cells[0]!.delta).toBe(30);
    expect(b.bidVolumeTotal).toBe(70);
    expect(b.askVolumeTotal).toBe(57);
    expect(b.candleDelta).toBe(-13);
    expect(b.candlePOC).toBe(101); // total 55 is the busiest row
  });

  it('flags a run of consecutive same-side imbalances as stacked', () => {
    const b = finalizeFootprintBar(
      bar([cell(100, 5, 40), cell(101, 5, 40), cell(102, 5, 40), cell(103, 40, 40)]),
      { imbalanceRatio: 3, stackedRun: 3 },
    );
    expect(b.cells[0]!.stackedImbalanceFlag).toBe(true);
    expect(b.cells[1]!.stackedImbalanceFlag).toBe(true);
    expect(b.cells[2]!.stackedImbalanceFlag).toBe(true);
    expect(b.cells[3]!.stackedImbalanceFlag).toBe(false); // balanced row breaks the run
  });

  it('flags a heavy, roughly-balanced row as absorption', () => {
    const b = finalizeFootprintBar(
      bar([cell(100, 5, 5), cell(101, 5, 5), cell(102, 50, 48), cell(103, 5, 6), cell(104, 4, 5)]),
      { absorptionVolumeMult: 2.5 },
    );
    expect(b.cells.find((c) => c.priceLevel === 102)!.absorptionFlag).toBe(true);
    expect(b.cells.find((c) => c.priceLevel === 100)!.absorptionFlag).toBe(false);
  });
});
