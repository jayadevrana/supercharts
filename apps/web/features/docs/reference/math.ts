import type { MATH } from '@supercharts/script-lang';
import type { DocEntry } from '../reference-types';

/**
 * `math.*` reference. Keyed against the real MATH object so a new math helper without a doc
 * entry is caught by the runtime coverage test. Every math function applies per bar to scalar values.
 */
export const MATH_DOCS: Record<keyof typeof MATH, DocEntry> = {
  abs: {
    signature: 'math.abs(x) → number',
    summary: 'Absolute value of x.',
    params: [{ name: 'x', type: 'number', desc: 'Any value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.abs(close - open), title: "candle body")',
  },
  sign: {
    signature: 'math.sign(x) → number',
    summary: 'Sign of x: -1, 0, or 1.',
    params: [{ name: 'x', type: 'number', desc: 'Any value.' }],
    returns: 'number (-1 | 0 | 1)',
    example: 'pulse 1\ndraw line(math.sign(close - open), title: "bar direction")',
  },
  floor: {
    signature: 'math.floor(x) → number',
    summary: 'Largest integer ≤ x.',
    params: [{ name: 'x', type: 'number', desc: 'Any value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.floor(close), title: "floor(close)")',
  },
  ceil: {
    signature: 'math.ceil(x) → number',
    summary: 'Smallest integer ≥ x.',
    params: [{ name: 'x', type: 'number', desc: 'Any value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.ceil(close), title: "ceil(close)")',
  },
  round: {
    signature: 'math.round(x, decimals?) → number',
    summary: 'Round x to the nearest integer, or to `decimals` places.',
    params: [
      { name: 'x', type: 'number', desc: 'Value to round.' },
      { name: 'decimals', type: 'number?', desc: 'Decimal places (0–12). Omitted = nearest integer.' },
    ],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.round(close, 2), title: "close rounded")',
  },
  sqrt: {
    signature: 'math.sqrt(x) → number',
    summary: 'Square root of x.',
    params: [{ name: 'x', type: 'number', desc: 'Non-negative value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.sqrt(volume), title: "sqrt(volume)")',
  },
  exp: {
    signature: 'math.exp(x) → number',
    summary: 'e raised to the power x.',
    params: [{ name: 'x', type: 'number', desc: 'Exponent.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.exp(close / open - 1), title: "exp(return)")',
  },
  log: {
    signature: 'math.log(x) → number',
    summary: 'Natural logarithm (base e) of x.',
    params: [{ name: 'x', type: 'number', desc: 'Positive value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.log(close), title: "ln(close)")',
  },
  log10: {
    signature: 'math.log10(x) → number',
    summary: 'Base-10 logarithm of x.',
    params: [{ name: 'x', type: 'number', desc: 'Positive value.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.log10(volume), title: "log10(volume)")',
  },
  pow: {
    signature: 'math.pow(base, exp) → number',
    summary: 'base raised to the power exp.',
    params: [
      { name: 'base', type: 'number', desc: 'Base.' },
      { name: 'exp', type: 'number', desc: 'Exponent.' },
    ],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.pow(close / open, 2), title: "ratio squared")',
  },
  sin: {
    signature: 'math.sin(x) → number',
    summary: 'Sine of x (x in radians).',
    params: [{ name: 'x', type: 'number', desc: 'Angle in radians.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.sin(barIndex / 10), title: "sine wave")',
  },
  cos: {
    signature: 'math.cos(x) → number',
    summary: 'Cosine of x (x in radians).',
    params: [{ name: 'x', type: 'number', desc: 'Angle in radians.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.cos(barIndex / 10), title: "cosine wave")',
  },
  tan: {
    signature: 'math.tan(x) → number',
    summary: 'Tangent of x (x in radians).',
    params: [{ name: 'x', type: 'number', desc: 'Angle in radians.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.tan(barIndex / 100), title: "tan")',
  },
  asin: {
    signature: 'math.asin(x) → number',
    summary: 'Arcsine of x, in radians (x in [-1, 1]).',
    params: [{ name: 'x', type: 'number', desc: 'Value in [-1, 1].' }],
    returns: 'number (radians)',
    example: 'pulse 1\ndraw line(math.asin(math.sin(barIndex / 10)), title: "asin")',
  },
  acos: {
    signature: 'math.acos(x) → number',
    summary: 'Arccosine of x, in radians (x in [-1, 1]).',
    params: [{ name: 'x', type: 'number', desc: 'Value in [-1, 1].' }],
    returns: 'number (radians)',
    example: 'pulse 1\ndraw line(math.acos(math.cos(barIndex / 10)), title: "acos")',
  },
  atan: {
    signature: 'math.atan(x) → number',
    summary: 'Arctangent of x, in radians.',
    params: [{ name: 'x', type: 'number', desc: 'Any value.' }],
    returns: 'number (radians)',
    example: 'pulse 1\ndraw line(math.atan(close - open), title: "atan(body)")',
  },
  atan2: {
    signature: 'math.atan2(y, x) → number',
    summary: 'Angle (radians) of the vector (x, y) — full quadrant.',
    params: [
      { name: 'y', type: 'number', desc: 'Y component.' },
      { name: 'x', type: 'number', desc: 'X component.' },
    ],
    returns: 'number (radians)',
    example: 'pulse 1\ndraw line(math.atan2(high - low, close), title: "atan2")',
  },
  toDegrees: {
    signature: 'math.toDegrees(radians) → number',
    summary: 'Convert radians to degrees.',
    params: [{ name: 'radians', type: 'number', desc: 'Angle in radians.' }],
    returns: 'number (degrees)',
    example: 'pulse 1\ndraw line(math.toDegrees(math.atan(close - open)), title: "slope°")',
  },
  toRadians: {
    signature: 'math.toRadians(degrees) → number',
    summary: 'Convert degrees to radians.',
    params: [{ name: 'degrees', type: 'number', desc: 'Angle in degrees.' }],
    returns: 'number (radians)',
    example: 'pulse 1\ndraw line(math.toRadians(45), title: "45° in rad")',
  },
  clamp: {
    signature: 'math.clamp(x, lo, hi) → number',
    summary: 'Constrain x to the range [lo, hi].',
    params: [
      { name: 'x', type: 'number', desc: 'Value to clamp.' },
      { name: 'lo', type: 'number', desc: 'Lower bound.' },
      { name: 'hi', type: 'number', desc: 'Upper bound.' },
    ],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.clamp(rsi(close, 14), 30, 70), title: "RSI clamped")',
  },
  min: {
    signature: 'math.min(a, b, …) → number',
    summary: 'Smallest of the given values.',
    params: [{ name: 'a, b, …', type: 'number…', desc: 'Two or more values.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.min(open, close), title: "candle bottom body")',
  },
  max: {
    signature: 'math.max(a, b, …) → number',
    summary: 'Largest of the given values.',
    params: [{ name: 'a, b, …', type: 'number…', desc: 'Two or more values.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.max(open, close), title: "candle top body")',
  },
  sum: {
    signature: 'math.sum(a, b, …) → number',
    summary: 'Sum of the given values (NOT a rolling window — see ta.sum for that).',
    params: [{ name: 'a, b, …', type: 'number…', desc: 'Values to add.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.sum(open, high, low, close) / 4, title: "OHLC avg")',
  },
  avg: {
    signature: 'math.avg(a, b, …) → number',
    summary: 'Arithmetic mean of the given values.',
    params: [{ name: 'a, b, …', type: 'number…', desc: 'Values to average.' }],
    returns: 'number',
    example: 'pulse 1\ndraw line(math.avg(high, low, close), title: "typical price")',
  },
};

/** `math.*` constants readable without a call. */
export const MATH_CONST_DOCS: Array<{ name: string; value: string; desc: string }> = [
  { name: 'math.pi', value: '3.14159…', desc: 'π — ratio of a circle’s circumference to its diameter.' },
  { name: 'math.e', value: '2.71828…', desc: 'Euler’s number, the base of the natural logarithm.' },
  { name: 'math.phi', value: '1.61803…', desc: 'The golden ratio, (1 + √5) / 2.' },
];
