import { describe, it, expect } from 'vitest';
import { topOfBook, formatSpread, isStaleBook } from '../apps/web/features/terminal/trade-buttons-util';

const T = 1_781_260_000_000;

describe('topOfBook', () => {
  it('extracts the touch from depth arrays (bids desc, asks asc)', () => {
    const top = topOfBook({
      bids: [
        [63796.47, 1.2],
        [63796.0, 3.4],
      ],
      asks: [
        [63796.48, 0.8],
        [63797.0, 2.0],
      ],
      eventTime: T,
    });
    expect(top).toEqual({ bid: 63796.47, ask: 63796.48, time: T });
  });

  it('rejects empty, non-positive, and crossed books — never shows fake markets', () => {
    expect(topOfBook({ bids: [], asks: [], eventTime: T })).toBeNull();
    expect(topOfBook({ bids: [[63796, 1]], asks: [], eventTime: T })).toBeNull();
    expect(topOfBook({ bids: [[0, 1]], asks: [[1, 1]], eventTime: T })).toBeNull();
    // crossed: ask below bid = corrupt frame
    expect(topOfBook({ bids: [[63800, 1]], asks: [[63790, 1]], eventTime: T })).toBeNull();
    expect(topOfBook({ bids: [[NaN, 1]], asks: [[63790, 1]], eventTime: T })).toBeNull();
  });

  it('accepts a locked (zero-spread) book', () => {
    const top = topOfBook({ bids: [[100, 1]], asks: [[100, 1]], eventTime: T });
    expect(top?.bid).toBe(100);
    expect(top?.ask).toBe(100);
  });
});

describe('formatSpread', () => {
  it('formats the TV-style raw spread', () => {
    expect(formatSpread(63796.47, 63796.48)).toBe('0.01');
    expect(formatSpread(100, 100)).toBe('0');
    expect(formatSpread(100, 101.5)).toBe('1.50');
    expect(formatSpread(1000, 1150)).toBe('150');
    expect(formatSpread(1.0855, 1.08561)).toBe('0.0001');
  });

  it('never renders a negative spread', () => {
    expect(formatSpread(101, 100)).toBe('—');
  });
});

describe('isStaleBook', () => {
  it('flags missing or old snapshots', () => {
    expect(isStaleBook(null, T)).toBe(true);
    expect(isStaleBook({ bid: 1, ask: 2, time: T - 11_000 }, T)).toBe(true);
    expect(isStaleBook({ bid: 1, ask: 2, time: T - 2_000 }, T)).toBe(false);
  });
});
