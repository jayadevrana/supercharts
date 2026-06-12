/**
 * PulseScript AST. Node shapes are an original design for SuperCharts (see
 * docs/pulsescript-design.md) — discriminated unions on `type`, every node carries
 * a source `pos` so the parser/interpreter can point at errors.
 */

export interface Pos {
  line: number;
  col: number;
}

/** A call argument — `named` for `title: "x"`, null name for a positional value. */
export interface Arg {
  name: string | null;
  value: Expr;
  pos: Pos;
}

export type Expr =
  | { type: 'num'; value: number; pos: Pos }
  | { type: 'str'; value: string; pos: Pos }
  | { type: 'bool'; value: boolean; pos: Pos }
  | { type: 'none'; pos: Pos }
  | { type: 'ident'; name: string; pos: Pos }
  | { type: 'member'; object: Expr; property: string; pos: Pos }
  | { type: 'index'; object: Expr; index: Expr; pos: Pos }
  | { type: 'call'; callee: Expr; args: Arg[]; pos: Pos }
  | { type: 'unary'; op: '-' | 'not'; operand: Expr; pos: Pos }
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: Pos }
  | { type: 'logical'; op: 'and' | 'or'; left: Expr; right: Expr; pos: Pos }
  | { type: 'ternary'; cond: Expr; then: Expr; else: Expr; pos: Pos }
  | { type: 'list'; items: Expr[]; pos: Pos };

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=';

export type DeclKind = 'let' | 'mut' | 'persist';
export type MarkKind = 'buy' | 'sell' | 'note';

export interface Param {
  name: string;
  default: Expr | null;
}

export type Stmt =
  | { type: 'decl'; kind: DeclKind; name: string; value: Expr; pos: Pos }
  | { type: 'assign'; name: string; value: Expr; pos: Pos }
  | { type: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null; pos: Pos }
  | { type: 'when'; cond: Expr; body: Stmt[]; pos: Pos }
  | { type: 'forIn'; varName: string; iter: Expr; body: Stmt[]; pos: Pos }
  | { type: 'forRange'; varName: string; from: Expr; to: Expr; body: Stmt[]; pos: Pos }
  | { type: 'while'; cond: Expr; body: Stmt[]; pos: Pos }
  | { type: 'break'; pos: Pos }
  | { type: 'continue'; pos: Pos }
  | { type: 'fn'; name: string; params: Param[]; body: Stmt[]; ret: Expr | null; pos: Pos }
  | { type: 'draw'; call: Expr; pos: Pos }
  | { type: 'mark'; kind: MarkKind; at: Expr | null; text: Expr | null; pos: Pos }
  | { type: 'expr'; expr: Expr; pos: Pos };

export interface MetaNode {
  args: Arg[];
  pos: Pos;
}

export interface Program {
  meta: MetaNode | null;
  body: Stmt[];
}
