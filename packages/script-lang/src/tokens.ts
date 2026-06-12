/**
 * PulseScript token model. PulseScript is SuperCharts' own language — these keywords
 * and punctuation are an original set (see docs/pulsescript-design.md).
 */

export type TokenKind =
  | 'num'
  | 'string'
  | 'ident'
  | 'keyword'
  | 'op' // + - * / % == != < > <= >= = ?
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'colon'
  | 'dot'
  | 'newline'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** Raw lexeme; for `string` it is the unescaped content, for `num` the digit text. */
  value: string;
  line: number;
  col: number;
}

/** PulseScript's reserved words. Declaration/structure words are deliberately our own. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'meta',
  'let',
  'mut',
  'persist',
  'when',
  'if',
  'else',
  'for',
  'in',
  'to',
  'while',
  'break',
  'continue',
  'fn',
  'draw',
  'mark',
  'buy',
  'sell',
  'note',
  'at',
  'shape',
  'true',
  'false',
  'none',
  'and',
  'or',
  'not',
]);
