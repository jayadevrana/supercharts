import { describe, it, expect } from 'vitest';
import { tokenize, LexError } from '../packages/script-lang/src/lexer';

/** Compact [kind, value] view of the non-eof tokens. */
function kinds(src: string): Array<[string, string]> {
  return tokenize(src)
    .filter((t) => t.kind !== 'eof')
    .map((t) => [t.kind, t.value] as [string, string]);
}

describe('PulseScript lexer', () => {
  it('lexes a meta declaration', () => {
    expect(kinds('meta(name: "EMA Cross", overlay: true)')).toEqual([
      ['keyword', 'meta'],
      ['lparen', '('],
      ['ident', 'name'],
      ['colon', ':'],
      ['string', 'EMA Cross'],
      ['comma', ','],
      ['ident', 'overlay'],
      ['colon', ':'],
      ['keyword', 'true'],
      ['rparen', ')'],
    ]);
  });

  it('lexes a let with a call and number', () => {
    expect(kinds('let fast = ema(close, 12)')).toEqual([
      ['keyword', 'let'],
      ['ident', 'fast'],
      ['op', '='],
      ['ident', 'ema'],
      ['lparen', '('],
      ['ident', 'close'],
      ['comma', ','],
      ['num', '12'],
      ['rparen', ')'],
    ]);
  });

  it('treats member access as ident DOT ident, and history as [ ]', () => {
    expect(kinds('ta.sma(close[1], 5)')).toEqual([
      ['ident', 'ta'],
      ['dot', '.'],
      ['ident', 'sma'],
      ['lparen', '('],
      ['ident', 'close'],
      ['lbracket', '['],
      ['num', '1'],
      ['rbracket', ']'],
      ['comma', ','],
      ['num', '5'],
      ['rparen', ')'],
    ]);
  });

  it('skips # comments and emits one newline between statements', () => {
    const k = kinds('let a = 1 # first\n\nlet b = 2');
    expect(k).toEqual([
      ['keyword', 'let'],
      ['ident', 'a'],
      ['op', '='],
      ['num', '1'],
      ['newline', '\n'],
      ['keyword', 'let'],
      ['ident', 'b'],
      ['op', '='],
      ['num', '2'],
    ]);
  });

  it('suppresses newlines inside parentheses (line continuation)', () => {
    const k = kinds('ema(close,\n  12)');
    expect(k.some(([kind]) => kind === 'newline')).toBe(false);
  });

  it('lexes two-char comparison operators and decimals', () => {
    expect(kinds('rsi >= 70.5')).toEqual([
      ['ident', 'rsi'],
      ['op', '>='],
      ['num', '70.5'],
    ]);
  });

  it('handles string escapes', () => {
    expect(tokenize('"a\\nb"')[0]!.value).toBe('a\nb');
  });

  it('throws LexError with position on bad input', () => {
    expect(() => tokenize('"unterminated')).toThrow(LexError);
    expect(() => tokenize('@')).toThrow(/unexpected character/);
  });
});
