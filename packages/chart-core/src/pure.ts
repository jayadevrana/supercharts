/**
 * Browser-free entry point.
 *
 * Anything in this file (and the modules it re-exports) must not reference DOM globals
 * (HTMLCanvasElement, window, ResizeObserver, etc.) so it can be consumed by the
 * Node API and ingestion services for pre-computed aggregates.
 */
export * from './profile-builder';
export * from './series/heikin-ashi';
export * from './series/renko';
export * from './series/range-bars';
export * from './series/line-break';
export * from './series/kagi';
export * from './series/point-and-figure';
export * from './indicators/index';
export * from './indicators/smc/index';
