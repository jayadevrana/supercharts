/**
 * PulseScript editor language support — CodeMirror 6 stream tokenizer + an original
 * dark highlight palette (Pine-editor-grade color grading, our own colors/tokens).
 * Builtin/keyword sets come straight from `@supercharts/script-lang` so the editor
 * never drifts from the language.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { BUILTIN_NAMES, KEYWORDS, PRICE_SOURCES } from '@supercharts/script-lang';

const CONTROL = new Set(['when', 'if', 'else', 'for', 'in', 'to', 'while', 'break', 'continue', 'and', 'or', 'not']);
const DECL = new Set(['pulse', 'meta', 'let', 'mut', 'persist', 'fn']);
const OUTPUT = new Set(['draw', 'paint', 'mark', 'at', 'shape', 'note']);
const ATOMS = new Set(['true', 'false', 'none']);
const NAMESPACES = new Set(['ta', 'math', 'input']);
const PRICES = new Set<string>([...PRICE_SOURCES, 'time', 'barIndex', 'barCount', 'lastBarIndex', 'isFirstBar', 'isLastBar', 'year', 'month', 'day', 'weekday', 'hour', 'minute', 'second']);

interface PulseStreamState {
  afterDot: boolean;
}

const pulseStream = StreamLanguage.define<PulseStreamState>({
  name: 'pulsescript',
  startState: () => ({ afterDot: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    const afterDot = state.afterDot;
    state.afterDot = false;

    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next();
        else if (ch === '"') break;
      }
      return 'string';
    }
    if (stream.match(/^\d+(\.\d+)?|^\.\d+/)) return 'number';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current();
      if (afterDot) return 'propertyName';
      const isCall = stream.peek() === '(';
      if (KEYWORDS.has(word)) {
        if (ATOMS.has(word)) return 'atom';
        if (word === 'buy') return 'inserted'; // styled bull-green below
        if (word === 'sell') return 'deleted'; // styled bear-red below
        if (DECL.has(word)) return 'definitionKeyword';
        if (OUTPUT.has(word)) return 'keyword';
        if (CONTROL.has(word)) return 'controlKeyword';
        return 'keyword';
      }
      if (NAMESPACES.has(word)) return 'namespace';
      if (PRICES.has(word)) return 'typeName'; // price/context series — its own color
      if (BUILTIN_NAMES.has(word)) return 'standard(variableName)'; // ema, crossOver, nz…
      if (isCall) return 'function(variableName)';
      return 'variableName';
    }
    if (stream.match(/^(==|!=|<=|>=|[+\-*/%=<>?])/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
});

/** Original dark palette tuned against the terminal's near-black surface. */
const pulseHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#66737f', fontStyle: 'italic' },
  { tag: t.string, color: '#7ee787' },
  { tag: t.number, color: '#f0b429' },
  { tag: t.atom, color: '#f78c6c' },
  { tag: t.controlKeyword, color: '#c792ea', fontWeight: '600' },
  { tag: t.definitionKeyword, color: '#82aaff', fontWeight: '600' },
  { tag: t.keyword, color: '#38bdf8', fontWeight: '600' },
  { tag: t.namespace, color: '#38bdf8' },
  { tag: t.typeName, color: '#4ec9b0' },
  { tag: t.standard(t.variableName), color: '#61afef' },
  { tag: t.function(t.variableName), color: '#ffd866' },
  { tag: t.propertyName, color: '#e5c07b' },
  { tag: t.operator, color: '#9aa7b8' },
  { tag: t.inserted, color: '#22c55e', fontWeight: '700' },
  { tag: t.deleted, color: '#ef4444', fontWeight: '700' },
  { tag: t.variableName, color: '#e6edf3' },
]);

/** Everything the editor needs to color-grade PulseScript. */
export function pulseExtensions(): Extension[] {
  return [pulseStream, syntaxHighlighting(pulseHighlight)];
}
