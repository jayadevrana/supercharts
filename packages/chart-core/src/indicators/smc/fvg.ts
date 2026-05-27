import {
  atrSeries,
  nextZoneId,
  type BarLike,
  type ZoneBox,
} from './shared';

export interface FvgInputs {
  /** ATR window used to filter trivial 3-candle gaps. */
  atrLen: number;
  /** Minimum gap height as multiple of ATR. 0 disables the filter. */
  atrMult: number;
  /** Drop zones older than this many bars (0 = never). */
  maxAge: number;
  /** Show zones once filled (default: false — fade them). */
  showMitigated: boolean;
}

export const DEFAULT_FVG_INPUTS: FvgInputs = {
  atrLen: 200,
  atrMult: 0.25,
  maxAge: 500,
  showMitigated: false,
};

/**
 * Fair Value Gap (FVG) + Inverse FVG detection.
 *
 *   bull FVG  → bar[i-1].high < bar[i+1].low; gap = [prev.high, next.low]
 *   bear FVG  → bar[i-1].low  > bar[i+1].high; gap = [next.high, prev.low]
 *
 * Mitigation rules (Hermes-corrected from the original spec):
 *   bull FVG    → mitigated when bar.low <= gap.top  (price re-enters the zone)
 *   bear FVG    → mitigated when bar.high >= gap.bot
 *   FVG → iFVG  → when a *mitigated* bull FVG is closed-through (bar.close < gap.bot)
 *                 the zone flips polarity and becomes a bearish iFVG, and vice versa.
 *
 * Returns every detected zone in chart-space coordinates.
 */
export function computeFvg(bars: ReadonlyArray<BarLike>, inputs: FvgInputs = DEFAULT_FVG_INPUTS): ZoneBox[] {
  const n = bars.length;
  if (n < 3) return [];
  const atr = atrSeries(bars, inputs.atrLen);
  const out: ZoneBox[] = [];

  for (let i = 1; i < n - 1; i += 1) {
    const prev = bars[i - 1]!;
    const next = bars[i + 1]!;
    const a = atr[i] ?? 0;
    const threshold = inputs.atrMult > 0 ? a * inputs.atrMult : 0;
    const t0 = bars[i]!.openTime;

    if (next.low > prev.high && next.low - prev.high >= threshold) {
      out.push({
        id: nextZoneId('fvg-bull'),
        side: 'bull',
        startIndex: i,
        endIndex: null,
        startTime: t0,
        endTime: null,
        top: next.low,
        bottom: prev.high,
        state: 'active',
        label: 'FVG',
      });
    }
    if (next.high < prev.low && prev.low - next.high >= threshold) {
      out.push({
        id: nextZoneId('fvg-bear'),
        side: 'bear',
        startIndex: i,
        endIndex: null,
        startTime: t0,
        endTime: null,
        top: prev.low,
        bottom: next.high,
        state: 'active',
        label: 'FVG',
      });
    }
  }

  // Mitigation + iFVG transition pass.
  for (let i = 1; i < n; i += 1) {
    const b = bars[i]!;
    for (const z of out) {
      if (z.startIndex >= i) continue;
      if (inputs.maxAge > 0 && i - z.startIndex > inputs.maxAge && z.state === 'active') {
        z.state = 'failed';
        z.endIndex = i;
        z.endTime = b.openTime;
        continue;
      }
      if (z.state === 'active') {
        if (z.side === 'bull' && b.low <= z.top && b.low >= z.bottom) {
          z.state = 'mitigated';
          z.endIndex = z.endIndex ?? i;
          z.endTime = z.endTime ?? b.openTime;
        } else if (z.side === 'bear' && b.high >= z.bottom && b.high <= z.top) {
          z.state = 'mitigated';
          z.endIndex = z.endIndex ?? i;
          z.endTime = z.endTime ?? b.openTime;
        }
      }
      // iFVG flip — close-through after mitigation
      if (z.state === 'mitigated') {
        if (z.side === 'bull' && b.close < z.bottom) {
          z.state = 'inverted';
          z.side = 'bear';
        } else if (z.side === 'bear' && b.close > z.top) {
          z.state = 'inverted';
          z.side = 'bull';
        }
      }
    }
  }

  return inputs.showMitigated ? out : out.filter((z) => z.state === 'active' || z.state === 'inverted');
}
