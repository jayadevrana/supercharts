import { describe, it, expect } from 'vitest';
import {
  sanitize,
  toggleFavorite,
  pushRecent,
  isFavorite,
  MAX_RECENT,
  EMPTY_PREFS,
} from '../apps/web/features/terminal/indicator-prefs';

describe('sanitize', () => {
  it('returns empty prefs for junk / missing data', () => {
    expect(sanitize(null)).toEqual(EMPTY_PREFS);
    expect(sanitize(42)).toEqual(EMPTY_PREFS);
    expect(sanitize({ favorites: 'nope', recent: { a: 1 } })).toEqual(EMPTY_PREFS);
  });
  it('keeps only non-empty strings and de-dupes', () => {
    expect(sanitize({ favorites: ['ema', 'ema', '', 3, 'rsi'], recent: ['sma'] })).toEqual({
      favorites: ['ema', 'rsi'],
      recent: ['sma'],
    });
  });
  it('caps recent at MAX_RECENT', () => {
    const recent = Array.from({ length: MAX_RECENT + 5 }, (_, i) => `i${i}`);
    expect(sanitize({ recent }).recent).toHaveLength(MAX_RECENT);
  });
});

describe('toggleFavorite', () => {
  it('adds when absent, removes when present, and is pure', () => {
    const a = toggleFavorite(EMPTY_PREFS, 'rsi');
    expect(a.favorites).toEqual(['rsi']);
    expect(EMPTY_PREFS.favorites).toEqual([]); // original untouched
    const b = toggleFavorite(a, 'rsi');
    expect(b.favorites).toEqual([]);
    expect(isFavorite(a, 'rsi')).toBe(true);
  });
  it('ignores a blank id', () => {
    expect(toggleFavorite(EMPTY_PREFS, '')).toEqual(EMPTY_PREFS);
  });
});

describe('pushRecent', () => {
  it('prepends, de-dupes (moving to front), and caps', () => {
    let p = EMPTY_PREFS;
    p = pushRecent(p, 'sma');
    p = pushRecent(p, 'ema');
    p = pushRecent(p, 'sma'); // re-add → moves to front, no dup
    expect(p.recent).toEqual(['sma', 'ema']);

    for (let i = 0; i < MAX_RECENT + 3; i += 1) p = pushRecent(p, `x${i}`);
    expect(p.recent).toHaveLength(MAX_RECENT);
    expect(p.recent[0]).toBe(`x${MAX_RECENT + 2}`);
  });
});
