import type { BarLike } from './shared';

export interface HvnLvnInputs {
  bins: number;
  /** Bin volume ≥ this fraction of max → HVN. */
  hvnPct: number;
  /** Bin volume ≤ this fraction of max → LVN. */
  lvnPct: number;
  /** Cumulative volume around POC defining the value area. */
  valuePct: number;
}

export const DEFAULT_HVNLVN_INPUTS: HvnLvnInputs = {
  bins: 60,
  hvnPct: 0.8,
  lvnPct: 0.2,
  valuePct: 0.7,
};

export interface HvnLvnLevel {
  price: number;
  volume: number;
  kind: 'hvn' | 'lvn';
}

export interface HvnLvnResult {
  poc: number;
  vah: number;
  val: number;
  levels: HvnLvnLevel[];
  profile: Array<{ price: number; volume: number }>;
  total: number;
}

/**
 * High Volume Node / Low Volume Node detector. Pure volume profile over the input
 * candles, then local-maxima / local-minima detection on bin volume.
 *
 * The caller is responsible for trimming `bars` to the visible window before passing it
 * here (cheap) — the layer does this on every visible-range change.
 */
export function computeHvnLvn(
  bars: ReadonlyArray<BarLike>,
  inputs: HvnLvnInputs = DEFAULT_HVNLVN_INPUTS,
): HvnLvnResult | null {
  if (bars.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  const bins = Math.max(10, Math.min(400, Math.floor(inputs.bins)));
  const binSize = (hi - lo) / bins;
  const profile = new Float64Array(bins);
  for (const b of bars) {
    const barRange = b.high - b.low || binSize;
    const volPerPx = b.volume / barRange;
    const startBin = Math.floor((b.low - lo) / binSize);
    const endBin = Math.floor((b.high - lo) / binSize);
    for (let bi = Math.max(0, startBin); bi <= Math.min(bins - 1, endBin); bi += 1) {
      const binLo = lo + bi * binSize;
      const binHi = binLo + binSize;
      const overlap = Math.max(0, Math.min(b.high, binHi) - Math.max(b.low, binLo));
      profile[bi] = (profile[bi] ?? 0) + volPerPx * overlap;
    }
  }
  let maxVol = 0;
  let pocBin = 0;
  for (let i = 0; i < bins; i += 1) {
    if (profile[i]! > maxVol) {
      maxVol = profile[i]!;
      pocBin = i;
    }
  }
  if (maxVol === 0) return null;
  const total = profile.reduce((s, v) => s + v, 0);
  const target = total * inputs.valuePct;
  let acc = profile[pocBin]!;
  let pLo = pocBin;
  let pHi = pocBin;
  while (acc < target && (pLo > 0 || pHi < bins - 1)) {
    const stepLo = pLo > 0 ? profile[pLo - 1]! : -1;
    const stepHi = pHi < bins - 1 ? profile[pHi + 1]! : -1;
    if (stepHi >= stepLo) {
      pHi += 1;
      acc += profile[pHi]!;
    } else {
      pLo -= 1;
      acc += profile[pLo]!;
    }
  }
  const val = lo + pLo * binSize;
  const vah = lo + (pHi + 1) * binSize;
  const poc = lo + (pocBin + 0.5) * binSize;
  const hvnThreshold = maxVol * inputs.hvnPct;
  const lvnThreshold = maxVol * inputs.lvnPct;
  const levels: HvnLvnLevel[] = [];
  for (let i = 1; i < bins - 1; i += 1) {
    const v = profile[i]!;
    if (v > profile[i - 1]! && v > profile[i + 1]! && v >= hvnThreshold) {
      levels.push({ price: lo + (i + 0.5) * binSize, volume: v, kind: 'hvn' });
    }
    if (v < profile[i - 1]! && v < profile[i + 1]! && v <= lvnThreshold && v > 0) {
      levels.push({ price: lo + (i + 0.5) * binSize, volume: v, kind: 'lvn' });
    }
  }
  return {
    poc,
    vah,
    val,
    levels,
    profile: Array.from(profile, (v, i) => ({ price: lo + (i + 0.5) * binSize, volume: v })),
    total,
  };
}
