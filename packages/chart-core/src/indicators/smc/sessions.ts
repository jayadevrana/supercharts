import type { BarLike } from './shared';

export interface SessionWindow {
  /** Local label, e.g. "London". */
  name: string;
  /** Inclusive start hour in ET (24h, fractional minutes via `startMinute`). */
  startHour: number;
  startMinute?: number;
  /** Exclusive end hour. */
  endHour: number;
  endMinute?: number;
  color: string;
  /** Default color while session is active (background tint). */
  killzoneColor: string;
}

export interface SessionsInputs {
  /** IANA timezone the windows are relative to. */
  tz: 'America/New_York' | 'UTC';
  /** Session definitions to apply. Default = Asia / London / NY AM / NY PM. */
  sessions: SessionWindow[];
  /** Show prior session's high/low extended to the right. */
  extendHL: boolean;
}

export const DEFAULT_SESSIONS_INPUTS: SessionsInputs = {
  tz: 'America/New_York',
  extendHL: true,
  sessions: [
    { name: 'Asia', startHour: 19, endHour: 23, color: '#95a5a6', killzoneColor: 'rgba(149,165,166,0.07)' },
    { name: 'London', startHour: 2, endHour: 5, color: '#3498db', killzoneColor: 'rgba(52,152,219,0.07)' },
    { name: 'NY AM', startHour: 7, endHour: 10, color: '#2ecc71', killzoneColor: 'rgba(46,204,113,0.07)' },
    { name: 'NY PM', startHour: 13, startMinute: 30, endHour: 16, color: '#e67e22', killzoneColor: 'rgba(230,126,34,0.07)' },
  ],
};

export interface SessionBlock {
  name: string;
  color: string;
  killzoneColor: string;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
}

/**
 * Sessions + ICT Killzones.
 *
 * For each bar, look up the local hour in the configured tz and check whether the bar
 * falls in any session window. Accumulate hi/lo per session and emit a SessionBlock
 * when the window closes.
 *
 * DST is handled via `Intl.DateTimeFormat` with the `timeZone` option, which respects
 * the IANA database.
 */
export function computeSessions(
  bars: ReadonlyArray<BarLike>,
  inputs: SessionsInputs = DEFAULT_SESSIONS_INPUTS,
): SessionBlock[] {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: inputs.tz,
    hour: 'numeric',
    hour12: false,
    minute: 'numeric',
  });
  const out: SessionBlock[] = [];
  type Active = SessionBlock & { sessionDef: SessionWindow };
  const active: Map<string, Active> = new Map();

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i]!;
    const parts = fmt.formatToParts(new Date(b.openTime));
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === 'hour') hour = parseInt(p.value, 10);
      if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    // `hour` from en-US can be 24 at midnight — normalize.
    if (hour === 24) hour = 0;
    for (const s of inputs.sessions) {
      const startMin = (s.startMinute ?? 0) + s.startHour * 60;
      const endMin = (s.endMinute ?? 0) + s.endHour * 60;
      const nowMin = hour * 60 + minute;
      const inWindow =
        startMin <= endMin
          ? nowMin >= startMin && nowMin < endMin
          : nowMin >= startMin || nowMin < endMin;
      const a = active.get(s.name);
      if (inWindow) {
        if (a) {
          if (b.high > a.high) a.high = b.high;
          if (b.low < a.low) a.low = b.low;
          a.endIndex = i;
          a.endTime = b.openTime;
        } else {
          active.set(s.name, {
            sessionDef: s,
            name: s.name,
            color: s.color,
            killzoneColor: s.killzoneColor,
            startIndex: i,
            endIndex: i,
            startTime: b.openTime,
            endTime: b.openTime,
            high: b.high,
            low: b.low,
          });
        }
      } else if (a) {
        out.push({
          name: a.name,
          color: a.color,
          killzoneColor: a.killzoneColor,
          startIndex: a.startIndex,
          endIndex: a.endIndex,
          startTime: a.startTime,
          endTime: a.endTime,
          high: a.high,
          low: a.low,
        });
        active.delete(s.name);
      }
    }
  }
  // Flush any still-open session.
  for (const a of active.values()) {
    out.push({
      name: a.name,
      color: a.color,
      killzoneColor: a.killzoneColor,
      startIndex: a.startIndex,
      endIndex: a.endIndex,
      startTime: a.startTime,
      endTime: a.endTime,
      high: a.high,
      low: a.low,
    });
  }
  return out;
}
