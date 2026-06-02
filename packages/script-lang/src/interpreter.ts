import type { Candle } from '@supercharts/types';
import type { Arg, Expr, MarkKind, Program, Stmt } from './ast';
import { parse } from './parser';
import { MATH, TA } from './stdlib';

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
  kind: 'line' | 'hist' | 'band';
  values: (number | null)[];
  /** Second edge of a `band(upper, lower, …)` output. */
  values2?: (number | null)[];
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
  /** Per-call-site cache of a series argument's values, grown bar-by-bar (locals-free calls only). */
  private seriesCache = new Map<Expr, { arr: number[]; upTo: number }>();
  /** Per-call-site cache of a stdlib call's output array, valid for the current top bar. */
  private callCache = new Map<Expr, { at: number; out: (number | boolean | null)[] }>();

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

  /**
   * `draw line(value, …)` / `draw hist(value, …)` / `draw band(upper, lower, …)`.
   * Captures per-bar value(s) into a plot buffer; `title`/`color` are named args.
   */
  private evalDraw(call: Expr, locals: Map<string, Value> | null): void {
    if (call.type !== 'call' || call.callee.type !== 'ident' || !['line', 'hist', 'band'].includes(call.callee.name)) {
      throw new RuntimeError("draw expects a 'line(...)', 'hist(...)' or 'band(...)' output", call.pos.line, call.pos.col);
    }
    const kind = call.callee.name as 'line' | 'hist' | 'band';
    let title: string | null = null;
    let color: string | null = null;
    const positional: Arg[] = [];
    for (const a of call.args) {
      if (a.name === 'title') title = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'color') color = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === null) positional.push(a);
    }
    const need = kind === 'band' ? 2 : 1;
    if (positional.length < need) {
      throw new RuntimeError(`draw ${kind}(...) needs ${need} value${need > 1 ? 's' : ''}`, call.pos.line, call.pos.col);
    }
    const key = title ?? `plot ${this.plotOrder.length + 1}`;
    let plot = this.plots.get(key);
    if (!plot) {
      plot = { title: key, color, kind, values: [], ...(kind === 'band' ? { values2: [] } : {}) };
      this.plots.set(key, plot);
      this.plotOrder.push(key);
    }
    if (color && !plot.color) plot.color = color;
    plot.values[this.i] = this.toNumOrNull(this.evalExpr(positional[0]!.value, this.i, locals));
    if (kind === 'band') {
      (plot.values2 ??= [])[this.i] = this.toNumOrNull(this.evalExpr(positional[1]!.value, this.i, locals));
    }
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
          `namespace member '.${e.property}' must be called, e.g. ta.sma(close, 20)`,
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
      const ns = e.callee.object.type === 'ident' ? e.callee.object.name : '?';
      const fn = e.callee.property;
      if (ns === 'math') return this.callMath(fn, e, bar, locals);
      if (ns === 'ta') return this.callTa(fn, e, bar, locals);
      if (ns === 'input') throw new RuntimeError(`'input.${fn}(…)' lands in task 5 (inputs)`, e.pos.line, e.pos.col);
      throw new RuntimeError(`unknown namespace '${ns}.${fn}'`, e.pos.line, e.pos.col);
    }
    if (e.callee.type !== 'ident') {
      throw new RuntimeError('only named function calls are supported', e.pos.line, e.pos.col);
    }
    const name = e.callee.name;
    const userFn = this.funcs.get(name);
    if (userFn) return this.callUserFn(name, userFn, e, bar, locals);
    if (name === 'nz') {
      const x = e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null;
      const d = e.args[1] ? this.evalExpr(e.args[1].value, bar, locals) : 0;
      return this.isNa(x) ? d : x;
    }
    if (name === 'na') return this.isNa(e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null);
    if (TA[name]) return this.callTa(name, e, bar, locals);
    throw new RuntimeError(`unknown function '${name}'`, e.pos.line, e.pos.col);
  }

  private callUserFn(name: string, fn: FnDef, e: Extract<Expr, { type: 'call' }>, bar: number, locals: Map<string, Value> | null): Value {
    const scope = new Map<string, Value>();
    for (let p = 0; p < fn.params.length; p++) {
      const param = fn.params[p]!;
      const arg = e.args[p];
      if (arg) scope.set(param.name, this.evalExpr(arg.value, bar, locals));
      else if (param.default) scope.set(param.name, this.evalExpr(param.default, bar, locals));
      else throw new RuntimeError(`missing argument '${param.name}' for ${name}()`, e.pos.line, e.pos.col);
    }
    if (fn.ret) return this.evalExpr(fn.ret, bar, scope);
    let result: Value = null;
    for (const st of fn.body) {
      if (st.type === 'expr') result = this.evalExpr(st.expr, bar, scope);
      else this.execStmt(st, scope);
    }
    return result;
  }

  /** `math.*` — scalar numeric helpers (args evaluated at the requested bar). */
  private callMath(fn: string, e: Extract<Expr, { type: 'call' }>, bar: number, locals: Map<string, Value> | null): Value {
    const m = MATH[fn];
    if (!m) throw new RuntimeError(`unknown math function 'math.${fn}'`, e.pos.line, e.pos.col);
    const r = m(e.args.map((a) => num(this.evalExpr(a.value, bar, locals))));
    return Number.isFinite(r) ? r : null;
  }

  /** `ta.*` / bare indicators — series args built over bars 0..current, output indexed at `bar`. */
  private callTa(fn: string, e: Extract<Expr, { type: 'call' }>, bar: number, locals: Map<string, Value> | null): Value {
    const spec = TA[fn];
    if (!spec) throw new RuntimeError(`unknown indicator '${fn}'`, e.pos.line, e.pos.col);
    const useCache = locals === null;
    let cc = useCache ? this.callCache.get(e) : undefined;
    if (!cc || cc.at !== this.i) {
      const sArgs: number[][] = [];
      for (let k = 0; k < spec.series; k++) {
        const arg = e.args[k];
        if (!arg) throw new RuntimeError(`'${fn}' needs a series argument`, e.pos.line, e.pos.col);
        sArgs.push(this.buildSeries(arg.value, locals));
      }
      const nums: number[] = [];
      for (let k = spec.series; k < e.args.length; k++) nums.push(num(this.evalExpr(e.args[k]!.value, this.i, locals)));
      cc = { at: this.i, out: spec.compute(sArgs, nums, this.candles) };
      if (useCache) this.callCache.set(e, cc);
    }
    const r = cc.out[bar];
    if (r == null) return null;
    if (typeof r === 'boolean') return r;
    return Number.isFinite(r) ? r : null;
  }

  /** Build an expression's per-bar number series over bars 0..current (memoised when locals-free). */
  private buildSeries(expr: Expr, locals: Map<string, Value> | null): number[] {
    if (locals === null) {
      let c = this.seriesCache.get(expr);
      if (!c) {
        c = { arr: [], upTo: -1 };
        this.seriesCache.set(expr, c);
      }
      while (c.upTo < this.i) {
        c.upTo += 1;
        c.arr[c.upTo] = this.toSeriesNum(this.evalExpr(expr, c.upTo, null));
      }
      return c.arr;
    }
    const arr: number[] = [];
    for (let b = 0; b <= this.i; b++) arr[b] = this.toSeriesNum(this.evalExpr(expr, b, locals));
    return arr;
  }

  private toSeriesNum(v: Value): number {
    return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
  }
  private isNa(v: Value): boolean {
    return v === null || (typeof v === 'number' && !Number.isFinite(v));
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
