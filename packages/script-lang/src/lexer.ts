import { KEYWORDS, type Token, type TokenKind } from './tokens';

/** A lexing error carrying the source position so the editor can point at it. */
export class LexError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'LexError';
  }
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=']);
const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '?']);

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
const isIdentPart = (c: string | undefined): boolean => isIdentStart(c) || isDigit(c);

/**
 * Tokenize PulseScript source. Newlines are significant (statement separators) at the top
 * level but suppressed inside `()`/`[]` so calls and expressions can wrap across lines.
 * `#` starts a line comment. Throws {@link LexError} with line/col on malformed input.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let bracketDepth = 0;
  const n = src.length;

  const push = (kind: TokenKind, value: string, ln: number, c: number): void => {
    tokens.push({ kind, value, line: ln, col: c });
  };
  const adv = (): string => {
    const ch = src[i++]!;
    if (ch === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    return ch;
  };

  while (i < n) {
    const ch = src[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      adv();
      continue;
    }
    if (ch === '#') {
      while (i < n && src[i] !== '\n') adv();
      continue;
    }
    if (ch === '\n') {
      const ln = line;
      const c = col;
      adv();
      if (bracketDepth === 0) {
        const last = tokens[tokens.length - 1];
        if (last && last.kind !== 'newline') push('newline', '\n', ln, c);
      }
      continue;
    }

    // number (allow leading dot: .5)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      const ln = line;
      const c = col;
      let s = '';
      let dots = 0;
      while (i < n && (isDigit(src[i]) || src[i] === '.')) {
        if (src[i] === '.') dots += 1;
        s += adv();
      }
      if (dots > 1) throw new LexError(`malformed number '${s}'`, ln, c);
      push('num', s, ln, c);
      continue;
    }

    // string
    if (ch === '"') {
      const ln = line;
      const c = col;
      adv();
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new LexError('unterminated string', ln, c);
        if (src[i] === '\\') {
          adv();
          const e = adv();
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else {
          s += adv();
        }
      }
      if (i >= n) throw new LexError('unterminated string', ln, c);
      adv(); // closing quote
      push('string', s, ln, c);
      continue;
    }

    // identifier / keyword
    if (isIdentStart(ch)) {
      const ln = line;
      const c = col;
      let s = '';
      while (i < n && isIdentPart(src[i])) s += adv();
      push(KEYWORDS.has(s) ? 'keyword' : 'ident', s, ln, c);
      continue;
    }

    // operators + punctuation
    const ln = line;
    const c = col;
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      adv();
      adv();
      push('op', two, ln, c);
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      adv();
      push('op', ch, ln, c);
      continue;
    }
    switch (ch) {
      case '(':
        adv();
        bracketDepth += 1;
        push('lparen', '(', ln, c);
        continue;
      case ')':
        adv();
        bracketDepth = Math.max(0, bracketDepth - 1);
        push('rparen', ')', ln, c);
        continue;
      case '{':
        adv();
        push('lbrace', '{', ln, c);
        continue;
      case '}':
        adv();
        push('rbrace', '}', ln, c);
        continue;
      case '[':
        adv();
        bracketDepth += 1;
        push('lbracket', '[', ln, c);
        continue;
      case ']':
        adv();
        bracketDepth = Math.max(0, bracketDepth - 1);
        push('rbracket', ']', ln, c);
        continue;
      case ',':
        adv();
        push('comma', ',', ln, c);
        continue;
      case ':':
        adv();
        push('colon', ':', ln, c);
        continue;
      case '.':
        adv();
        push('dot', '.', ln, c);
        continue;
      case '!':
        throw new LexError("unexpected '!' — use 'not' or '!='", ln, c);
      default:
        throw new LexError(`unexpected character '${ch}'`, ln, c);
    }
  }

  // Drop a trailing separator, then terminate.
  if (tokens.length > 0 && tokens[tokens.length - 1]!.kind === 'newline') tokens.pop();
  push('eof', '', line, col);
  return tokens;
}
