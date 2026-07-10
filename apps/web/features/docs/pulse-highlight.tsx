/**
 * Server-safe PulseScript syntax highlighting for docs pages — zero client JS per block.
 * Token CLASSIFICATION imports the language's own keyword/builtin sets from
 * `@supercharts/script-lang` (same source of truth as the editor's tokenizer in
 * `features/terminal/pulse-language.ts`), so docs colors can never drift from the language.
 * Colors live in `.pulse-code .tok-*` rules in globals.css, mirroring the editor palette.
 */

import type { ReactNode } from 'react';
import { BUILTIN_NAMES, KEYWORDS, PRICE_SOURCES } from '@supercharts/script-lang';

const CONTROL = new Set(['when', 'if', 'else', 'for', 'in', 'to', 'while', 'break', 'continue', 'and', 'or', 'not']);
const DECL = new Set(['pulse', 'meta', 'let', 'mut', 'persist', 'fn']);
const OUTPUT = new Set(['draw', 'paint', 'mark', 'at', 'shape', 'note']);
const ATOMS = new Set(['true', 'false', 'none']);
const NAMESPACES = new Set(['ta', 'math', 'input']);
const PRICES = new Set<string>([...PRICE_SOURCES, 'time', 'barIndex', 'barCount', 'lastBarIndex', 'isFirstBar', 'isLastBar', 'year', 'month', 'day', 'weekday', 'hour', 'minute', 'second']);

interface Tok {
  text: string;
  cls: string | null;
}

/** Tokenize one line (comments/strings never span lines in PulseScript). */
function tokenizeLine(line: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let afterDot = false;
  const push = (text: string, cls: string | null) => {
    if (text) toks.push({ text, cls });
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i]!;
    if (ch === '#') {
      push(rest, 'tok-comment');
      break;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
      push(line.slice(i, Math.min(j + 1, line.length)), 'tok-string');
      i = j + 1;
      afterDot = false;
      continue;
    }
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(rest);
    if (num) {
      push(num[0], 'tok-number');
      i += num[0].length;
      afterDot = false;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      const w = word[0];
      const isCall = line[i + w.length] === '(';
      let cls: string | null = null;
      if (afterDot) cls = 'tok-prop';
      else if (KEYWORDS.has(w)) {
        if (ATOMS.has(w)) cls = 'tok-atom';
        else if (w === 'buy') cls = 'tok-buy';
        else if (w === 'sell') cls = 'tok-sell';
        else if (DECL.has(w)) cls = 'tok-decl';
        else if (OUTPUT.has(w)) cls = 'tok-output';
        else if (CONTROL.has(w)) cls = 'tok-control';
        else cls = 'tok-output';
      } else if (NAMESPACES.has(w)) cls = 'tok-namespace';
      else if (PRICES.has(w)) cls = 'tok-price';
      else if (BUILTIN_NAMES.has(w)) cls = 'tok-builtin';
      else if (isCall) cls = 'tok-fn';
      push(w, cls);
      i += w.length;
      afterDot = false;
      continue;
    }
    const op = /^(==|!=|<=|>=|[+\-*/%=<>?])/.exec(rest);
    if (op) {
      push(op[0], 'tok-op');
      i += op[0].length;
      afterDot = false;
      continue;
    }
    afterDot = ch === '.';
    push(ch, null);
    i += 1;
  }
  return toks;
}

/** Highlight PulseScript source into styled spans (pure, server-renderable). */
export function highlightPulse(code: string): ReactNode {
  return code.split('\n').map((line, li) => (
    <span key={li}>
      {tokenizeLine(line).map((t, ti) =>
        t.cls ? (
          <span key={ti} className={t.cls}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
      {'\n'}
    </span>
  ));
}
