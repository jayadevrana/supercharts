import type { DocEntry } from '../reference-types';

/**
 * `input.*` reference. Each `input.*` declaration becomes a control in the editor's Inputs panel;
 * changing a value re-runs the script. Signature: `input.<kind>(default, title?, …)`. The keys
 * here are the six real input kinds (interpreter InputKind).
 */
export const INPUT_DOCS: Record<'num' | 'source' | 'bool' | 'text' | 'select' | 'color', DocEntry> = {
  num: {
    signature: 'input.num(default, title?, min:, max:) → number',
    summary: 'A numeric input — renders as a number field (with optional min/max bounds).',
    params: [
      { name: 'default', type: 'number', desc: 'Initial value.' },
      { name: 'title', type: 'text?', desc: 'Label shown in the Inputs panel.' },
      { name: 'min / max', type: 'number?', desc: 'Named bounds, e.g. `min: 2, max: 200`.' },
    ],
    returns: 'number',
    example: 'pulse 1\nlen = input.num(20, "Length", min: 2, max: 200)\ndraw line(sma(close, len), title: "SMA")',
  },
  source: {
    signature: 'input.source(default) → series',
    summary: 'A price-series picker — lets the user choose close / open / high / low / hl2 / hlc3 / etc.',
    params: [{ name: 'default', type: 'series', desc: 'Default price series, e.g. `close`.' }],
    returns: 'price series',
    example: 'pulse 1\nsrc = input.source(close)\ndraw line(ema(src, 20), title: "EMA of source")',
  },
  bool: {
    signature: 'input.bool(default, title?) → bool',
    summary: 'A toggle switch.',
    params: [
      { name: 'default', type: 'bool', desc: 'Initial on/off.' },
      { name: 'title', type: 'text?', desc: 'Label.' },
    ],
    returns: 'bool',
    example: 'pulse 1\nshowMarks = input.bool(true, "Show signals")\nwhen showMarks and crossOver(ema(close, 9), ema(close, 21)): mark buy at low "Long"',
  },
  text: {
    signature: 'input.text(default, title?) → text',
    summary: 'A free-text input — handy for custom mark/alert labels.',
    params: [
      { name: 'default', type: 'text', desc: 'Initial string.' },
      { name: 'title', type: 'text?', desc: 'Label.' },
    ],
    returns: 'text',
    example: 'pulse 1\nlabel = input.text("Long", "Buy label")\nwhen crossOver(ema(close, 9), ema(close, 21)): mark buy at low label',
  },
  select: {
    signature: 'input.select(default, title?, options: [...]) → text',
    summary: 'A dropdown of fixed choices.',
    params: [
      { name: 'default', type: 'text', desc: 'Default option (must be in the list).' },
      { name: 'title', type: 'text?', desc: 'Label.' },
      { name: 'options', type: 'text[]', desc: 'Named list of choices, e.g. `options: ["fast", "slow"]`.' },
    ],
    returns: 'text (the chosen option)',
    example: 'pulse 1\nmode = input.select("fast", "Mode", options: ["fast", "slow"])\nlen = mode == "fast" ? 9 : 21\ndraw line(ema(close, len), title: "EMA")',
  },
  color: {
    signature: 'input.color(default, title?) → color',
    summary: 'A colour picker — feed the result into any output’s `color:` argument.',
    params: [
      { name: 'default', type: 'color', desc: 'Default colour string, e.g. `"#38bdf8"`.' },
      { name: 'title', type: 'text?', desc: 'Label.' },
    ],
    returns: 'color string',
    example: 'pulse 1\ncol = input.color("#38bdf8", "Line colour")\ndraw line(sma(close, 20), color: col, title: "SMA")',
  },
};
