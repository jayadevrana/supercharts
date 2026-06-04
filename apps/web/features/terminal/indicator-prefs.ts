/**
 * Indicator browser preferences — favorites + recently-used (Mission, increment 1).
 *
 * Persisted to localStorage with a versioned, corruption-safe schema (the app has server-side
 * persistence too, but favorites/recents are device-local UX that should work offline and with
 * zero round-trips). The pure transforms (`toggleFavorite`, `pushRecent`, `sanitize`) are unit
 * tested; the `read`/`write` side-effects are thin wrappers around them.
 */

const KEY = 'sc.indicatorPrefs.v1';
export const MAX_RECENT = 12;

export interface IndicatorPrefs {
  /** Entry ids the user starred. */
  favorites: string[];
  /** Entry ids most-recently added, newest first, capped at MAX_RECENT. */
  recent: string[];
}

export const EMPTY_PREFS: IndicatorPrefs = { favorites: [], recent: [] };

/** Coerce arbitrary parsed JSON into a valid IndicatorPrefs, dropping anything malformed. */
export function sanitize(raw: unknown): IndicatorPrefs {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))) : [];
  return {
    favorites: strList(obj.favorites),
    recent: strList(obj.recent).slice(0, MAX_RECENT),
  };
}

export function isFavorite(prefs: IndicatorPrefs, id: string): boolean {
  return prefs.favorites.includes(id);
}

/** Add the id if absent, remove it if present. Pure. */
export function toggleFavorite(prefs: IndicatorPrefs, id: string): IndicatorPrefs {
  if (!id) return prefs;
  const has = prefs.favorites.includes(id);
  return {
    ...prefs,
    favorites: has ? prefs.favorites.filter((x) => x !== id) : [...prefs.favorites, id],
  };
}

/** Move/insert id at the front of `recent`, de-duped and capped at MAX_RECENT. Pure. */
export function pushRecent(prefs: IndicatorPrefs, id: string): IndicatorPrefs {
  if (!id) return prefs;
  const next = [id, ...prefs.recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
  return { ...prefs, recent: next };
}

/* ───── localStorage side-effects (guarded for SSR + corruption) ───── */

export function readPrefs(): IndicatorPrefs {
  if (typeof window === 'undefined') return EMPTY_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_PREFS;
    return sanitize(JSON.parse(raw));
  } catch {
    return EMPTY_PREFS;
  }
}

export function writePrefs(prefs: IndicatorPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sanitize(prefs)));
  } catch {
    /* quota / disabled storage — favorites are best-effort */
  }
}
