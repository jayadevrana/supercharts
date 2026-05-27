/**
 * Pure builder for visible-range volume profile. No DOM dependencies — safe to import
 * from Node services (API, ingestion).
 */

export interface ProfileInputCandle {
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
}

export interface VolumeProfileLevel {
  priceLevel: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  trades: number;
  isPOC: boolean;
  isHVN: boolean;
  isLVN: boolean;
  inValueArea: boolean;
}

export interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  rowSize: number;
  levels: VolumeProfileLevel[];
}

export function buildVisibleRangeProfile(
  candles: ReadonlyArray<ProfileInputCandle>,
  rowSize: number,
  valueAreaPercent: number,
): VolumeProfileResult {
  if (candles.length === 0 || rowSize <= 0) {
    return { poc: 0, vah: 0, val: 0, totalVolume: 0, rowSize, levels: [] };
  }
  const buckets = new Map<number, { buy: number; sell: number; total: number; trades: number }>();
  for (const k of candles) {
    const low = Math.floor(k.low / rowSize) * rowSize;
    const high = Math.ceil(k.high / rowSize) * rowSize;
    const rows = Math.max(1, Math.round((high - low) / rowSize));
    const perRow = k.volume / rows;
    const buyShare = k.volume > 0 ? k.buyVolume / k.volume : 0;
    for (let i = 0; i < rows; i += 1) {
      const price = low + i * rowSize + rowSize / 2;
      const key = Math.round(price / rowSize) * rowSize;
      const slot = buckets.get(key) ?? { buy: 0, sell: 0, total: 0, trades: 0 };
      slot.total += perRow;
      slot.buy += perRow * buyShare;
      slot.sell += perRow * (1 - buyShare);
      slot.trades += 1;
      buckets.set(key, slot);
    }
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, v]) => s + v.total, 0);
  if (total === 0 || sorted.length === 0) {
    return { poc: 0, vah: 0, val: 0, totalVolume: 0, rowSize, levels: [] };
  }
  let pocIdx = 0;
  let pocVol = -Infinity;
  sorted.forEach(([, v], i) => {
    if (v.total > pocVol) {
      pocVol = v.total;
      pocIdx = i;
    }
  });
  const target = total * valueAreaPercent;
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = sorted[pocIdx]![1].total;
  while (acc < target && (lo > 0 || hi < sorted.length - 1)) {
    const next = lo > 0 ? sorted[lo - 1]![1].total : -1;
    const prev = hi < sorted.length - 1 ? sorted[hi + 1]![1].total : -1;
    if (next >= prev && lo > 0) {
      lo -= 1;
      acc += sorted[lo]![1].total;
    } else if (hi < sorted.length - 1) {
      hi += 1;
      acc += sorted[hi]![1].total;
    } else {
      break;
    }
  }
  const val = sorted[lo]![0];
  const vah = sorted[hi]![0];
  const poc = sorted[pocIdx]![0];
  const hvn = pocVol * 0.6;
  const lvn = pocVol * 0.15;
  const levels: VolumeProfileLevel[] = sorted.map(([price, v], i) => ({
    priceLevel: price,
    totalVolume: v.total,
    buyVolume: v.buy,
    sellVolume: v.sell,
    delta: v.buy - v.sell,
    trades: v.trades,
    isPOC: i === pocIdx,
    isHVN: v.total >= hvn,
    isLVN: v.total <= lvn,
    inValueArea: i >= lo && i <= hi,
  }));
  return { poc, vah, val, totalVolume: total, rowSize, levels };
}
