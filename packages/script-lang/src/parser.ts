import { tokenize } from './lexer';
import type { Token, TokenKind } from './tokens';
import type { Arg, BinaryOp, DeclKind, Expr, MarkKind, MetaNode, Param, Program, Stmt } from './ast';

/** A parse error carrying source position so the editor can underline it. */
export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'ParseError';
  }
}

const COMPARISON = new Set(['==', '!=', '<', '>', '<=', '>=']);
const MARK_KINDS = new Set<MarkKind>(['buy', 'sell', 'note']);

class Parser {
  private toks: Token[];
  private i = 0;

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(offset = 0): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)]!;
  }
  private at(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }
  private atKeyword(word: string): boolean {
    return this.at('keyword', word);
  }
  private advance(): Token {
    return this.toks[this.i++]!;
  }
  private expect(kind: TokenKind, value?: string): Token {
    if (!this.at(kind, value)) this.fail(`expected ${value ?? kind}`);
    return this.advance();
  }
  private fail(message: string): never {
    const t = this.peek();
    throw new ParseError(`${message}, found '${t.value || t.kind}'`, t.line, t.col);
  }
  private skipNewlines(): void {
    while (this.at('newline')) this.advance();
  }
  private posOf(t: Token): { line: number; col: number } {
    return { line: t.line, col: t.col };
  }

  parseProgram(): Program {
    this.skipNewlines();
    // Optional version header: `pulse 1` on its own line at the very top.
    let version: number | null = null;
    if (this.atKeyword('pulse')) {
      this.advance();
      const v = this.expect('num');
      version = Number(v.value);
      this.skipNewlines();
    }
    let meta: MetaNode | null = null;
    if (this.atKeyword('meta')) meta = this.parseMeta();
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.at('eof')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { version, meta, body };
  }

  private parseMeta(): MetaNode {
    const kw = this.advance();
    this.expect('lparen');
    const args = this.parseArgs();
    this.expect('rparen');
    return { args, pos: this.posOf(kw) };
  }

  private parseBlock(): Stmt[] {
    this.expect('lbrace');
    this.skipNewlines();
    const body: Stmt[] = [];
    while (!this.at('rbrace') && !this.at('eof')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect('rbrace');
    return body;
  }

  /**
   * A statement body: either a `{ … }` block or the low-indent colon form —
   * `when cond: mark buy` — which takes exactly one statement on the same line.
   */
  private parseBody(): Stmt[] {
    if (this.at('colon')) {
      this.advance();
      return [this.parseStatement()];
    }
    return this.parseBlock();
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.kind === 'keyword') {
      switch (t.value) {
        case 'let':
        case 'mut':
        case 'persist':
          return this.parseDecl();
        case 'if':
          return this.parseIf();
        case 'when':
          return this.parseWhen();
        case 'for':
          return this.parseFor();
        case 'while':
          return this.parseWhile();
        case 'break': {
          const kw = this.advance();
          return { type: 'break', pos: this.posOf(kw) };
        }
        case 'continue': {
          const kw = this.advance();
          return { type: 'continue', pos: this.posOf(kw) };
        }
        case 'fn':
          return this.parseFn();
        case 'draw':
          return this.parseDraw();
        case 'paint':
          return this.parsePaint();
        case 'mark':
          return this.parseMark();
        default:
          break;
      }
    }
    // assignment: IDENT '=' expr  (target must be a bare identifier)
    if (t.kind === 'ident' && this.peek(1).kind === 'op' && this.peek(1).value === '=') {
      const name = this.advance().value;
      this.advance(); // '='
      const value = this.parseExpr();
      return { type: 'assign', name, value, pos: this.posOf(t) };
    }
    const expr = this.parseExpr();
    return { type: 'expr', expr, pos: this.posOf(t) };
  }

  private parseDecl(): Stmt {
    const kw = this.advance();
    const name = this.expect('ident').value;
    this.expect('op', '=');
    const value = this.parseExpr();
    return { type: 'decl', kind: kw.value as DeclKind, name, value, pos: this.posOf(kw) };
  }

  /** Optional `else` may sit on the line after the `}`; save/restore around the newline skip. */
  private maybeElse(): Stmt[] | null {
    const save = this.i;
    this.skipNewlines();
    if (this.atKeyword('else')) {
      this.advance();
      if (this.atKeyword('if')) return [this.parseIf()];
      return this.parseBody();
    }
    this.i = save;
    return null;
  }

  private parseIf(): Stmt {
    const kw = this.advance();
    const cond = this.parseExpr();
    const then = this.parseBody();
    const elseBody = this.maybeElse();
    return { type: 'if', cond, then, else: elseBody, pos: this.posOf(kw) };
  }

  private parseWhen(): Stmt {
    const kw = this.advance();
    const cond = this.parseExpr();
    const body = this.parseBody();
    return { type: 'when', cond, body, pos: this.posOf(kw) };
  }

  private parseFor(): Stmt {
    const kw = this.advance();
    const varName = this.expect('ident').value;
    if (this.atKeyword('in')) {
      this.advance();
      const iter = this.parseExpr();
      const body = this.parseBody();
      return { type: 'forIn', varName, iter, body, pos: this.posOf(kw) };
    }
    this.expect('op', '=');
    const from = this.parseExpr();
    this.expect('keyword', 'to');
    const to = this.parseExpr();
    const body = this.parseBody();
    return { type: 'forRange', varName, from, to, body, pos: this.posOf(kw) };
  }

  private parseWhile(): Stmt {
    const kw = this.advance();
    const cond = this.parseExpr();
    const body = this.parseBody();
    return { type: 'while', cond, body, pos: this.posOf(kw) };
  }

  private parseFn(): Stmt {
    const kw = this.advance();
    const name = this.expect('ident').value;
    this.expect('lparen');
    const params: Param[] = [];
    while (!this.at('rparen')) {
      const pName = this.expect('ident').value;
      let def: Expr | null = null;
      if (this.at('op', '=')) {
        this.advance();
        def = this.parseExpr();
      }
      params.push({ name: pName, default: def });
      if (this.at('comma')) this.advance();
      else break;
    }
    this.expect('rparen');
    // `fn f(x) = expr`  (expression body) OR `fn f(x) { ... }` (block body)
    if (this.at('op', '=')) {
      this.advance();
      const ret = this.parseExpr();
      return { type: 'fn', name, params, body: [], ret, pos: this.posOf(kw) };
    }
    const body = this.parseBlock();
    return { type: 'fn', name, params, body, ret: null, pos: this.posOf(kw) };
  }

  private parseDraw(): Stmt {
    const kw = this.advance();
    const call = this.parseExpr();
    return { type: 'draw', call, pos: this.posOf(kw) };
  }

  /** `paint bg(color)` / `paint candles(color)` — per-bar colour outputs. */
  private parsePaint(): Stmt {
    const kw = this.advance();
    const call = this.parseExpr();
    return { type: 'paint', call, pos: this.posOf(kw) };
  }

  private parseMark(): Stmt {
    const kw = this.advance();
    const kindTok = this.peek();
    if (!(kindTok.kind === 'keyword' && MARK_KINDS.has(kindTok.value as MarkKind))) {
      this.fail('expected buy, sell, or note after mark');
    }
    this.advance();
    const kind = kindTok.value as MarkKind;
    let at: Expr | null = null;
    if (this.atKeyword('at')) {
      this.advance();
      at = this.parseExpr();
    }
    // optional trailing text expression on the same logical line
    let text: Expr | null = null;
    if (!this.at('newline') && !this.at('rbrace') && !this.at('eof')) {
      text = this.parseExpr();
    }
    return { type: 'mark', kind, at, text, pos: this.posOf(kw) };
  }

  // ---- expressions (precedence climbing) ----

  private parseExpr(): Expr {
    return this.parseTernary();
  }
  /** `cond ? a : b` — lowest precedence, right-associative (`a ? b : c ? d : e` nests right). */
  private parseTernary(): Expr {
    const cond = this.parseOr();
    if (!this.at('op', '?')) return cond;
    const q = this.advance();
    const then = this.parseTernary();
    this.expect('colon');
    const elseE = this.parseTernary();
    return { type: 'ternary', cond, then, else: elseE, pos: this.posOf(q) };
  }
  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.atKeyword('or')) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { type: 'logical', op: 'or', left, right, pos: this.posOf(op) };
    }
    return left;
  }
  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.atKeyword('and')) {
      const op = this.advance();
      const right = this.parseNot();
      left = { type: 'logical', op: 'and', left, right, pos: this.posOf(op) };
    }
    return left;
  }
  private parseNot(): Expr {
    if (this.atKeyword('not')) {
      const op = this.advance();
      return { type: 'unary', op: 'not', operand: this.parseNot(), pos: this.posOf(op) };
    }
    return this.parseComparison();
  }
  private parseComparison(): Expr {
    let left = this.parseAdd();
    while (this.at('op') && COMPARISON.has(this.peek().value)) {
      const op = this.advance();
      const right = this.parseAdd();
      left = { type: 'binary', op: op.value as BinaryOp, left, right, pos: this.posOf(op) };
    }
    return left;
  }
  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.at('op', '+') || this.at('op', '-')) {
      const op = this.advance();
      const right = this.parseMul();
      left = { type: 'binary', op: op.value as BinaryOp, left, right, pos: this.posOf(op) };
    }
    return left;
  }
  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.at('op', '*') || this.at('op', '/') || this.at('op', '%')) {
      const op = this.advance();
      const right = this.parseUnary();
      left = { type: 'binary', op: op.value as BinaryOp, left, right, pos: this.posOf(op) };
    }
    return left;
  }
  private parseUnary(): Expr {
    if (this.at('op', '-')) {
      const op = this.advance();
      return { type: 'unary', op: '-', operand: this.parseUnary(), pos: this.posOf(op) };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('dot')) {
        this.advance();
        // Property position is unambiguous, so keywords are fine here (`.at()`, `.to()`, …).
        const prop = this.peek();
        if (prop.kind !== 'ident' && prop.kind !== 'keyword') this.fail('expected a member name');
        this.advance();
        expr = { type: 'member', object: expr, property: prop.value, pos: this.posOf(prop) };
      } else if (this.at('lbracket')) {
        const lb = this.advance();
        const index = this.parseExpr();
        this.expect('rbracket');
        expr = { type: 'index', object: expr, index, pos: this.posOf(lb) };
      } else if (this.at('lparen')) {
        const lp = this.advance();
        const args = this.parseArgs();
        this.expect('rparen');
        expr = { type: 'call', callee: expr, args, pos: this.posOf(lp) };
      } else {
        return expr;
      }
    }
  }
  private parseArgs(): Arg[] {
    const args: Arg[] = [];
    while (!this.at('rparen') && !this.at('eof')) {
      const t = this.peek();
      // named arg: NAME ':' expr — keywords allowed as names (`at:`, `shape:`), unambiguous here
      if ((t.kind === 'ident' || t.kind === 'keyword') && this.peek(1).kind === 'colon') {
        const name = this.advance().value;
        this.advance(); // ':'
        args.push({ name, value: this.parseExpr(), pos: this.posOf(t) });
      } else {
        args.push({ name: null, value: this.parseExpr(), pos: this.posOf(t) });
      }
      if (this.at('comma')) this.advance();
      else break;
    }
    return args;
  }
  private parsePrimary(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.advance();
        return { type: 'num', value: Number(t.value), pos: this.posOf(t) };
      case 'string':
        this.advance();
        return { type: 'str', value: t.value, pos: this.posOf(t) };
      case 'ident':
        this.advance();
        return { type: 'ident', name: t.value, pos: this.posOf(t) };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          this.advance();
          return { type: 'bool', value: t.value === 'true', pos: this.posOf(t) };
        }
        if (t.value === 'none') {
          this.advance();
          return { type: 'none', pos: this.posOf(t) };
        }
        this.fail(`unexpected keyword '${t.value}' in expression`);
        break;
      case 'lparen': {
        this.advance();
        const inner = this.parseExpr();
        this.expect('rparen');
        return inner;
      }
      case 'lbracket': {
        // List literal `[a, b, c]` — only in value position; postfix `expr[n]` stays the history operator.
        const lb = this.advance();
        const items: Expr[] = [];
        while (!this.at('rbracket') && !this.at('eof')) {
          items.push(this.parseExpr());
          if (this.at('comma')) this.advance();
          else break;
        }
        this.expect('rbracket');
        return { type: 'list', items, pos: this.posOf(lb) };
      }
      default:
        this.fail('expected an expression');
    }
    // unreachable (fail throws)
    throw new ParseError('unreachable', t.line, t.col);
  }
}

/** Parse PulseScript source into a {@link Program} AST. Throws {@link ParseError}. */
export function parse(src: string): Program {
  return new Parser(tokenize(src)).parseProgram();
}
