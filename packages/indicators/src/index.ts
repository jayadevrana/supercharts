/**
 * Classic TA indicator suite used by SuperCharts. All functions are pure,
 * operate on `Candle[]` (sorted by openTime ascending), and return arrays
 * aligned 1:1 with the input bars. `NaN` is used for the warm-up region
 * where the indicator does not have enough lookback to produce a value.
 */

export * from './ma';
export * from './oscillators';
export * from './volatility';
export * from './trend';
export * from './volume';
export * from './profile';
export * from './patterns';
export * from './runner';
export * from './registry';
