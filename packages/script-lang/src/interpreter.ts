import type { Candle } from '@supercharts/types';
import type { Arg, Expr, MarkKind, Program, Stmt } from './ast';
import { parse } from './parser';

/**
 * PulseScript bar-by-bar interpreter (Phase 6 task 3 — core).
 *
 * The program body runs once per bar, oldest→newest. A bare `close` is this bar's
 * value; `close[n]` (and `myVar[n]`) looks back n bars — implemented by re-evaluating
 * the operand in the context of bar `i-n`, using the per-bar history every top-level
 * binding records. `let` recomputes each bar, `mut` is reassignable within a bar,
 * `persist` initialises once and carries across bars. `draw line(expr, …)` captures a
 * per-bar plot buffer; `mark buy/sell/note` records a signal at the bar.
 *
 * The `ta.*` / `math.*` standard library + richer outputs land in task 4; this core
 * provides the price series, arithmetic/logic/control-flow, user `fn`s, and history.
 */

export type Value = number | boolean | string | null;

export interface Plot {
  title: string;
  color: string | null;
  values: (number | null)[];
}
export interface Mark {
  bar: number;
  kind: MarkKind;
  price: number | null;
  text: string | null;
}
export interface RunResult {
  meta: Record<string, Value>;
  plots: Plot[];
  marks: Mark[];
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'RuntimeError';
  }
}

interface Binding {
  kind: 'let' | 'mut' | 'persist';
  history: Value[];
}
interface FnDef {
  params: { name: string; default: Expr | null }[];
  body: Stmt[];
  ret: Expr | null;
}

const isNone = (v: Value): v is null => v === null;
const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);

export interface RunOptions {
  /** Hard cap on total loop iterations across the run (runaway guard). Default 5,000,000. */
  maxLoopSteps?: number;
}

class Interpreter {
  private globals = new Map<string, Binding>();
  private funcs = new Map<string, FnDef>();
  private plots = new Map<string, Plot>();
  private plotOrder: string[] = [];
  private marks: Mark[] = [];
  private meta: Record<string, Value> = {};
  private i = 0; // current bar
  private loopSteps = 0;
  private readonly maxLoopSteps: number;

  constructor(
    private program: Program,
    private candles: readonly Candle[],
    opts: RunOptions = {},
  ) {
    this.maxLoopSteps = opts.maxLoopSteps ?? 5_000_000;
  }

  run(): RunResult {
    // Pre-register top-level functions so calls can precede definitions.
    for (const s of this.program.body) {
      if (s.type === 'fn') this.funcs.set(s.name, { params: s.params, body: s.body, ret: s.ret });
    }
    if (this.program.meta) {
      for (const a of this.program.meta.args) {
        if (a.name) this.meta[a.name] = this.evalExpr(a.value, 0, null);
      }
    }
    for (this.i = 0; this.i < this.candles.length; this.i++) {
      for (const s of this.program.body) this.execStmt(s, null);
    }
    return {
      meta: this.meta,
      plots: this.plotOrder.map((t) => this.plots.get(t)!),
      marks: this.marks,
    };
  }

  // ---- statements ----
  private execStmt(s: Stmt, locals: Map<string, Value> | null): void {
    switch (s.type) {
      case 'fn':
        return; // pre-registered
      case 'decl': {
        if (locals) {
          locals.set(s.name, this.evalExpr(s.value, this.i, locals));
          return;
        }
        let b = this.globals.get(s.name);
        if (s.kind === 'persist' && b) {
          b.history[this.i] = this.i > 0 ? b.history[this.i - 1]! : this.evalExpr(s.value, this.i, null);
          return;
        }
        if (!b) {
          b = { kind: s.kind, history: [] };
          this.globals.set(s.name, b);
        }
        b.history[this.i] = this.evalExpr(s.value, this.i, locals);
        return;
      }
      case 'assign': {
        if (locals && locals.has(s.name)) {
          locals.set(s.name, this.evalExpr(s.value, this.i, locals));
          return;
        }
        const b = this.globals.get(s.name);
        if (!b) throw new RuntimeError(`assignment to undeclared '${s.name}'`, s.pos.line, s.pos.col);
        if (b.kind === 'let') throw new RuntimeError(`cannot reassign 'let ${s.name}' (use mut/persist)`, s.pos.line, s.pos.col);
        b.history[this.i] = this.evalExpr(s.value, this.i, locals);
        return;
      }
      case 'if': {
        if (this.truthy(this.evalExpr(s.cond, this.i, locals))) {
          for (const st of s.then) this.execStmt(st, locals);
        } else if (s.else) {
          for (const st of s.else) this.execStmt(st, locals);
        }
        return;
      }
      case 'when': {
        if (this.truthy(this.evalExpr(s.cond, this.i, locals))) {
          for (const st of s.body) this.execStmt(st, locals);
        }
        return;
      }
      case 'forRange': {
        const from = num(this.evalExpr(s.from, this.i, locals));
        const to = num(this.evalExpr(s.to, this.i, locals));
        const step = from <= to ? 1 : -1;
        const inner = locals ?? new Map<string, Value>();
        for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
          this.tick(s.pos);
          inner.set(s.varName, v);
          for (const st of s.body) this.execStmt(st, inner);
        }
        return;
      }
      case 'forIn': {
        const iter = this.evalExpr(s.iter, this.i, locals);
        if (!Array.isArray(iter)) throw new RuntimeError(`'for in' expects a list`, s.pos.line, s.pos.col);
        const inner = locals ?? new Map<string, Value>();
        for (const v of iter as Value[]) {
          this.tick(s.pos);
          inner.set(s.varName, v);
          for (const st of s.body) this.execStmt(st, inner);
        }
        return;
      }
      case 'draw':
        this.evalDraw(s.call, locals);
        return;
      case 'mark': {
        const price = s.at ? this.toNumOrNull(this.evalExpr(s.at, this.i, locals)) : this.candles[this.i]!.close;
        const text = s.text ? String(this.evalExpr(s.text, this.i, locals) ?? '') : null;
        this.marks.push({ bar: this.i, kind: s.kind, price, text });
        return;
      }
      case 'expr':
        this.evalExpr(s.expr, this.i, locals);
        return;
    }
  }

  private tick(pos: { line: number; col: number }): void {
    this.loopSteps += 1;
    if (this.loopSteps > this.maxLoopSteps) {
      throw new RuntimeError('loop step limit exceeded', pos.line, pos.col);
    }
  }

  /** `draw line(value, color?, title?)` captures the value into a per-bar plot buffer. */
  private evalDraw(call: Expr, locals: Map<string, Value> | null): void {
    if (call.type !== 'call' || call.callee.type !== 'ident' || call.callee.name !== 'line') {
      throw new RuntimeError("draw expects a 'line(...)' output (more output kinds in task 4)", call.pos.line, call.pos.col);
    }
    let title: string | null = null;
    let color: string | null = null;
    let valueArg: Arg | null = null;
    for (const a of call.args) {
      if (a.name === 'title') title = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'color') color = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === null && !valueArg) valueArg = a;
    }
    if (!valueArg) throw new RuntimeError('draw line(...) needs a value', call.pos.line, call.pos.col);
    const value = this.toNumOrNull(this.evalExpr(valueArg.value, this.i, locals));
    const key = title ?? `plot ${this.plotOrder.length + 1}`;
    let plot = this.plots.get(key);
    if (!plot) {
      plot = { title: key, color, values: [] };
      this.plots.set(key, plot);
      this.plotOrder.push(key);
    }
    if (color && !plot.color) plot.color = color;
    plot.values[this.i] = value;
  }

  // ---- expressions ----
  private evalExpr(e: Expr, bar: number, locals: Map<string, Value> | null): Value {
    switch (e.type) {
      case 'num':
        return e.value;
      case 'str':
        return e.value;
      case 'bool':
        return e.value;
      case 'none':
        return null;
      case 'ident':
        return this.lookup(e.name, bar, locals, e);
      case 'unary': {
        if (e.op === 'not') return !this.truthy(this.evalExpr(e.operand, bar, locals));
        const v = this.evalExpr(e.operand, bar, locals);
        return isNone(v) ? null : -num(v);
      }
      case 'logical': {
        const l = this.evalExpr(e.left, bar, locals);
        if (e.op === 'and') return this.truthy(l) ? this.truthy(this.evalExpr(e.right, bar, locals)) : false;
        return this.truthy(l) ? true : this.truthy(this.evalExpr(e.right, bar, locals));
      }
      case 'binary':
        return this.evalBinary(e, bar, locals);
      case 'index': {
        const n = num(this.evalExpr(e.index, bar, locals));
        const back = bar - Math.trunc(n);
        if (back < 0 || back >= this.candles.length) return null;
        return this.evalExpr(e.object, back, locals);
      }
      case 'call':
        return this.evalCall(e, bar, locals);
      case 'member':
        throw new RuntimeError(
          `namespace access '.${e.property}' is not available yet (ta.*/math.* land in task 4)`,
          e.pos.line,
          e.pos.col,
        );
    }
  }

  private evalBinary(e: Extract<Expr, { type: 'binary' }>, bar: number, locals: Map<string, Value> | null): Value {
    const l = this.evalExpr(e.left, bar, locals);
    const r = this.evalExpr(e.right, bar, locals);
    switch (e.op) {
      case '==':
        return this.equals(l, r);
      case '!=':
        return !this.equals(l, r);
    }
    if (e.op === '+' && (typeof l === 'string' || typeof r === 'string')) {
      return `${this.display(l)}${this.display(r)}`;
    }
    if (isNone(l) || isNone(r)) {
      // Comparisons with none are false; arithmetic with none is none.
      return e.op === '<' || e.op === '>' || e.op === '<=' || e.op === '>=' ? false : null;
    }
    const a = num(l);
    const b = num(r);
    switch (e.op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return a / b;
      case '%':
        return a % b;
      case '<':
        return a < b;
      case '>':
        return a > b;
      case '<=':
        return a <= b;
      case '>=':
        return a >= b;
    }
  }

  private evalCall(e: Extract<Expr, { type: 'call' }>, bar: number, locals: Map<string, Value> | null): Value {
    if (e.callee.type === 'member') {
      const obj = e.callee.object.type === 'ident' ? e.callee.object.name : '?';
      throw new RuntimeError(
        `'${obj}.${e.callee.property}(…)' is not available yet (ta.*/math.* land in task 4)`,
        e.pos.line,
        e.pos.col,
      );
    }
    if (e.callee.type !== 'ident') {
      throw new RuntimeError('only named function calls are supported in the core', e.pos.line, e.pos.col);
    }
    const name = e.callee.name;
    const fn = this.funcs.get(name);
    if (!fn) throw new RuntimeError(`unknown function '${name}'`, e.pos.line, e.pos.col);
    const scope = new Map<string, Value>();
    for (let p = 0; p < fn.params.length; p++) {
      const param = fn.params[p]!;
      const arg = e.args[p];
      if (arg) scope.set(param.name, this.evalExpr(arg.value, bar, locals));
      else if (param.default) scope.set(param.name, this.evalExpr(param.default, bar, locals));
      else throw new RuntimeError(`missing argument '${param.name}' for ${name}()`, e.pos.line, e.pos.col);
    }
    if (fn.ret) return this.evalExpr(fn.ret, bar, scope);
    // Block body: last expression statement is the return value.
    let result: Value = null;
    for (const st of fn.body) {
      if (st.type === 'expr') result = this.evalExpr(st.expr, bar, scope);
      else this.execStmt(st, scope);
    }
    return result;
  }

  private lookup(name: string, bar: number, locals: Map<string, Value> | null, e: Expr): Value {
    if (locals && locals.has(name)) return locals.get(name)!;
    const g = this.globals.get(name);
    if (g) return bar >= 0 && bar < g.history.length ? (g.history[bar] ?? null) : null;
    const c = this.candles[bar];
    if (!c) return null;
    switch (name) {
      case 'close':
        return c.close;
      case 'open':
        return c.open;
      case 'high':
        return c.high;
      case 'low':
        return c.low;
      case 'volume':
        return c.volume;
      case 'time':
        return c.openTime;
      case 'barIndex':
        return bar;
      case 'hl2':
        return (c.high + c.low) / 2;
      case 'hlc3':
        return (c.high + c.low + c.close) / 3;
      case 'ohlc4':
        return (c.open + c.high + c.low + c.close) / 4;
      case 'none':
        return null;
      default:
        throw new RuntimeError(`undefined name '${name}'`, e.pos.line, e.pos.col);
    }
  }

  private truthy(v: Value): boolean {
    return v === true;
  }
  private equals(a: Value, b: Value): boolean {
    if (isNone(a) || isNone(b)) return isNone(a) && isNone(b);
    return a === b;
  }
  private display(v: Value): string {
    return isNone(v) ? 'none' : String(v);
  }
  private toNumOrNull(v: Value): number | null {
    if (isNone(v)) return null;
    const n = num(v);
    return Number.isFinite(n) ? n : null;
  }
}

/** Run a parsed PulseScript program over candles. */
export function interpret(program: Program, candles: readonly Candle[], opts?: RunOptions): RunResult {
  return new Interpreter(program, candles, opts).run();
}

/** Parse + run PulseScript source over candles. */
export function runScript(src: string, candles: readonly Candle[], opts?: RunOptions): RunResult {
  return interpret(parse(src), candles, opts);
}
