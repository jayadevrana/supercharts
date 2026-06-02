import type { Candle } from '@supercharts/types';
import { priceFromCandle, type PriceSource } from '@supercharts/indicators';
import type { Arg, Expr, MarkKind, Program, Stmt } from './ast';
import { parse } from './parser';
import { MATH, TA, type TaFn, type TaOut } from './stdlib';

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
export type InputKind = 'num' | 'bool' | 'text' | 'source';
/** A declared `input.*(...)` — the editor renders these as form controls and feeds overrides back. */
export interface InputDef {
  id: string;
  kind: InputKind;
  title: string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  /** Allowed price-series names for a `source` input. */
  options?: string[];
}
export interface RunResult {
  meta: Record<string, Value>;
  inputs: InputDef[];
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
  /**
   * Last bar whose history slot was actually written. Lets a `persist` carry its last
   * *defined* value across bars where its (conditional) declaration was skipped — bar `i-1`
   * can be a hole when the decl lives inside an `if`/`when`/`for` that didn't run last bar.
   */
  lastSet?: number;
}
interface FnDef {
  params: { name: string; default: Expr | null }[];
  body: Stmt[];
  ret: Expr | null;
}

const isNone = (v: Value): v is null => v === null;
const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);

/** The price-series names a script (and `input.source`) can read off each candle. */
export const PRICE_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'] as const;
/** Read a named price series off a candle: the indicators package's price math, plus `volume`. */
function priceOf(name: string, c: Candle): number | null {
  if (name === 'volume') return c.volume;
  return (PRICE_SOURCES as readonly string[]).includes(name) ? priceFromCandle(c, name as PriceSource) : null;
}
/** Identifiers whose value at a given bar is fixed by the candle alone (no execution-built state). */
const STABLE_PRICE_NAMES = new Set<string>([...PRICE_SOURCES, 'barIndex', 'time', 'none']);
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** Coerce an input default/override to a bool consistently (true / 1 / "true" / "1"). */
const toBoolInput = (v: Value): boolean => v === true || v === 1 || v === 'true' || v === '1';

export interface RunOptions {
  /** Hard cap on total loop iterations across the run (runaway guard). Default 5,000,000. */
  maxLoopSteps?: number;
  /** Override values for declared `input.*` controls, keyed by input id. */
  inputs?: Record<string, number | boolean | string>;
}

/** Direct sub-expressions of an expression (for AST walks). */
function exprChildren(e: Expr): Expr[] {
  switch (e.type) {
    case 'member':
      return [e.object];
    case 'index':
      return [e.object, e.index];
    case 'call':
      return [e.callee, ...e.args.map((a) => a.value)];
    case 'unary':
      return [e.operand];
    case 'binary':
    case 'logical':
      return [e.left, e.right];
    default:
      return [];
  }
}

/** Every expression contained in a statement subtree (including nested blocks). */
function* stmtExprs(s: Stmt): Generator<Expr> {
  switch (s.type) {
    case 'decl':
    case 'assign':
      yield s.value;
      return;
    case 'if':
      yield s.cond;
      for (const t of s.then) yield* stmtExprs(t);
      if (s.else) for (const t of s.else) yield* stmtExprs(t);
      return;
    case 'when':
      yield s.cond;
      for (const t of s.body) yield* stmtExprs(t);
      return;
    case 'forIn':
      yield s.iter;
      for (const t of s.body) yield* stmtExprs(t);
      return;
    case 'forRange':
      yield s.from;
      yield s.to;
      for (const t of s.body) yield* stmtExprs(t);
      return;
    case 'fn':
      for (const p of s.params) if (p.default) yield p.default;
      for (const t of s.body) yield* stmtExprs(t);
      if (s.ret) yield s.ret;
      return;
    case 'draw':
      yield s.call;
      return;
    case 'mark':
      if (s.at) yield s.at;
      if (s.text) yield s.text;
      return;
    case 'expr':
      yield s.expr;
      return;
  }
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
  /** Per-call-site cache of a stdlib call's output array, valid for the current top bar (per-bar fallback). */
  private callCache = new Map<Expr, { at: number; out: TaOut }>();
  /** series:0 studies (atr/vwap/macd/stoch) depend only on candles + params → one result per (fn, params) for the whole run. */
  private taParamCache = new Map<string, TaOut>();
  /** Per-call-site cache for a bar-invariant series-based call → computed once over the full range, then just indexed. */
  private taRunCache = new Map<Expr, TaOut>();
  /** Memoised "is this ta call bar-invariant (cache-safe)?" decision, per call site. */
  private taStable = new Map<Expr, boolean>();
  /** Every name the script binds (decls / fn names+params / loop vars) — a reference to one of these is not a pure candle read. */
  private declaredNames = new Set<string>();
  /** Declared inputs (the editor's form schema), discovered in a pre-pass. */
  private inputDefs: InputDef[] = [];
  private inputByExpr = new Map<Expr, InputDef>();
  private readonly inputOverrides: Record<string, number | boolean | string>;

  constructor(
    private program: Program,
    private candles: readonly Candle[],
    opts: RunOptions = {},
  ) {
    this.maxLoopSteps = opts.maxLoopSteps ?? 5_000_000;
    this.inputOverrides = opts.inputs ?? {};
  }

  run(): RunResult {
    // Pre-register top-level functions so calls can precede definitions.
    for (const s of this.program.body) {
      if (s.type === 'fn') this.funcs.set(s.name, { params: s.params, body: s.body, ret: s.ret });
    }
    this.collectDeclaredNames(); // before any evalExpr (meta/inputs) can reach the ta cache
    this.collectInputs();
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
      inputs: this.inputDefs,
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
          // Carry the last *defined* value (not bar i-1, which is a hole when this decl
          // was skipped last bar); seed lazily the very first time the decl runs.
          b.history[this.i] = b.lastSet != null ? (b.history[b.lastSet] ?? null) : this.evalExpr(s.value, this.i, null);
          b.lastSet = this.i;
          return;
        }
        if (!b) {
          b = { kind: s.kind, history: [] };
          this.globals.set(s.name, b);
        }
        b.history[this.i] = this.evalExpr(s.value, this.i, locals);
        b.lastSet = this.i;
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
        b.lastSet = this.i;
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
      if (ns === 'input') return this.resolveInput(e, bar);
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
    return this.finiteOrNull(m(e.args.map((a) => num(this.evalExpr(a.value, bar, locals)))));
  }

  /** A computed number passes through when finite; NaN/±Infinity collapse to none. */
  private finiteOrNull(n: number): number | null {
    return Number.isFinite(n) ? n : null;
  }

  /**
   * `ta.*` / bare indicators — series args built over bars 0..current, output indexed at `bar`.
   * Scalar params (e.g. period) are read at the current top bar, so a constant or input-driven
   * period is exact everywhere; a period that *varies per bar* is only correct on the current bar,
   * not when the call is read through `[n]` history (the cached output uses the current period).
   */
  private callTa(fn: string, e: Extract<Expr, { type: 'call' }>, bar: number, locals: Map<string, Value> | null): Value {
    const spec = TA[fn];
    if (!spec) throw new RuntimeError(`unknown indicator '${fn}'`, e.pos.line, e.pos.col);
    const r = this.taOutput(fn, spec, e, locals)[bar];
    if (r == null) return null;
    return typeof r === 'boolean' ? r : this.finiteOrNull(r);
  }

  /**
   * Resolve a ta call's full output array, memoised so each call site computes once over a run
   * instead of once per bar (the old behaviour was O(n²) per call site):
   *  - series:0 studies (atr/vwap/macd/stoch) depend only on the candles + scalar params, so the
   *    whole run shares one result keyed by (fn, params) — independent of the current bar;
   *  - a series-based call whose arguments are all candle-derived with constant params is likewise
   *    bar-invariant → computed once over the full range, then just indexed;
   *  - anything that can vary per bar (params off `close`, a series off `persist`/`mut` state) keeps
   *    the per-top-bar recompute, reused within the bar.
   * The indicators are causal, so indexing `out[bar]` never reads a future bar in any path.
   */
  private taOutput(fn: string, spec: TaFn, e: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null): TaOut {
    if (locals !== null) return this.computeTa(fn, spec, e, locals, this.i); // inside a fn — no cross-call memo

    if (spec.series === 0) {
      const nums = this.taParams(spec, e, null);
      const key = `${fn}|${nums.join(',')}`;
      let out = this.taParamCache.get(key);
      if (!out) {
        out = spec.compute([], nums, this.candles);
        this.taParamCache.set(key, out);
      }
      return out;
    }

    let stable = this.taStable.get(e);
    if (stable === undefined) {
      stable = this.taArgsStable(spec, e);
      this.taStable.set(e, stable);
    }
    if (stable) {
      let out = this.taRunCache.get(e);
      if (!out) {
        out = this.computeTa(fn, spec, e, null, this.candles.length - 1);
        this.taRunCache.set(e, out);
      }
      return out;
    }

    let cc = this.callCache.get(e);
    if (!cc || cc.at !== this.i) {
      cc = { at: this.i, out: this.computeTa(fn, spec, e, null, this.i) };
      this.callCache.set(e, cc);
    }
    return cc.out;
  }

  /** A ta call's scalar params, read at the current top bar. */
  private taParams(spec: TaFn, e: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null): number[] {
    const nums: number[] = [];
    for (let k = spec.series; k < e.args.length; k++) nums.push(num(this.evalExpr(e.args[k]!.value, this.i, locals)));
    return nums;
  }

  /** Build a ta call's series args (over bars 0..upTo) and params, then run the indicator. */
  private computeTa(fn: string, spec: TaFn, e: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null, upTo: number): TaOut {
    const sArgs: number[][] = [];
    for (let k = 0; k < spec.series; k++) {
      const arg = e.args[k];
      if (!arg) throw new RuntimeError(`'${fn}' needs a series argument`, e.pos.line, e.pos.col);
      sArgs.push(this.buildSeries(arg.value, locals, upTo));
    }
    return spec.compute(sArgs, this.taParams(spec, e, locals), this.candles);
  }

  /** A ta call is cache-safe when every series arg is a stable candle read and every scalar param is constant. */
  private taArgsStable(spec: TaFn, e: Extract<Expr, { type: 'call' }>): boolean {
    for (let k = 0; k < e.args.length; k++) {
      const ok = k < spec.series ? this.isStableSeries(e.args[k]!.value) : this.isConst(e.args[k]!.value);
      if (!ok) return false;
    }
    return true;
  }

  /** A series expr whose per-bar value is fixed by the candles alone (no `persist`/`mut`/local state). */
  private isStableSeries(e: Expr): boolean {
    switch (e.type) {
      case 'num':
      case 'str':
      case 'bool':
      case 'none':
        return true;
      case 'ident':
        return STABLE_PRICE_NAMES.has(e.name) && !this.declaredNames.has(e.name);
      case 'unary':
        return this.isStableSeries(e.operand);
      case 'binary':
      case 'logical':
        return this.isStableSeries(e.left) && this.isStableSeries(e.right);
      case 'index':
        return this.isStableSeries(e.object) && this.isConst(e.index);
      case 'call':
        return this.isStableCall(e, false);
      case 'member':
        return false;
    }
  }

  /** An expr that evaluates to the same scalar on every bar — required of a param before it can seed a run-wide cache. */
  private isConst(e: Expr): boolean {
    switch (e.type) {
      case 'num':
      case 'str':
      case 'bool':
      case 'none':
        return true;
      case 'unary':
        return this.isConst(e.operand);
      case 'binary':
      case 'logical':
        return this.isConst(e.left) && this.isConst(e.right);
      case 'call':
        return this.isStableCall(e, true);
      case 'ident': // price sources / barIndex / globals all vary per bar
      case 'index':
      case 'member':
        return false;
    }
  }

  /** `input.*` is constant per run; `math.*` mirrors its args; `ta.*` needs stable series + const params. `constOnly` forbids per-bar reads. */
  private isStableCall(e: Extract<Expr, { type: 'call' }>, constOnly: boolean): boolean {
    const stableArgs = (): boolean => e.args.every((a) => (constOnly ? this.isConst(a.value) : this.isStableSeries(a.value)));
    if (e.callee.type === 'member' && e.callee.object.type === 'ident') {
      const ns = e.callee.object.name;
      if (ns === 'input') return true;
      if (ns === 'math') return stableArgs();
      if (ns === 'ta') return !constOnly && TA[e.callee.property] !== undefined && this.taArgsStable(TA[e.callee.property]!, e);
      return false;
    }
    if (e.callee.type === 'ident' && !this.funcs.has(e.callee.name)) {
      const name = e.callee.name;
      if (TA[name]) return !constOnly && this.taArgsStable(TA[name]!, e);
      if (name === 'nz' || name === 'na') return stableArgs();
    }
    return false; // user fns aren't analysed → treated as per-bar
  }

  /** Build an expression's per-bar number series over bars 0..upTo (memoised when locals-free). */
  private buildSeries(expr: Expr, locals: Map<string, Value> | null, upTo: number = this.i): number[] {
    if (locals === null) {
      let c = this.seriesCache.get(expr);
      if (!c) {
        c = { arr: [], upTo: -1 };
        this.seriesCache.set(expr, c);
      }
      while (c.upTo < upTo) {
        c.upTo += 1;
        c.arr[c.upTo] = this.toSeriesNum(this.evalExpr(expr, c.upTo, null));
      }
      return c.arr;
    }
    const arr: number[] = [];
    for (let b = 0; b <= upTo; b++) arr[b] = this.toSeriesNum(this.evalExpr(expr, b, locals));
    return arr;
  }

  private toSeriesNum(v: Value): number {
    return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
  }
  private isNa(v: Value): boolean {
    return v === null || (typeof v === 'number' && !Number.isFinite(v));
  }

  /** Pre-pass: record every name the script binds, so the ta cache can tell a candle read from script state. */
  private collectDeclaredNames(): void {
    const walk = (stmts: Stmt[]): void => {
      for (const s of stmts) {
        switch (s.type) {
          case 'decl':
            this.declaredNames.add(s.name);
            break;
          case 'fn':
            this.declaredNames.add(s.name);
            for (const p of s.params) this.declaredNames.add(p.name);
            walk(s.body);
            break;
          case 'if':
            walk(s.then);
            if (s.else) walk(s.else);
            break;
          case 'when':
            walk(s.body);
            break;
          case 'forRange':
          case 'forIn':
            this.declaredNames.add(s.varName);
            walk(s.body);
            break;
        }
      }
    };
    walk(this.program.body);
  }

  private lookup(name: string, bar: number, locals: Map<string, Value> | null, e: Expr): Value {
    if (locals && locals.has(name)) return locals.get(name)!;
    const g = this.globals.get(name);
    if (g) return bar >= 0 && bar < g.history.length ? (g.history[bar] ?? null) : null;
    const c = this.candles[bar];
    if (!c) return null;
    if (name === 'time') return c.openTime;
    if (name === 'barIndex') return bar;
    if (name === 'none') return null;
    const p = priceOf(name, c);
    if (p !== null) return p;
    throw new RuntimeError(`undefined name '${name}'`, e.pos.line, e.pos.col);
  }

  // ---- inputs (task 5) ----
  private isInputCall(e: Expr): e is Extract<Expr, { type: 'call' }> {
    return (
      e.type === 'call' &&
      e.callee.type === 'member' &&
      e.callee.object.type === 'ident' &&
      e.callee.object.name === 'input'
    );
  }

  /** Pre-pass: discover every `input.*(...)` call, assign a stable id, build the form schema. */
  private collectInputs(): void {
    const declName = new Map<Expr, string>();
    for (const s of this.program.body) {
      if (s.type === 'decl' && this.isInputCall(s.value)) declName.set(s.value, s.name);
    }
    const used = new Set<string>();
    let auto = 0;
    const seen = new Set<Expr>();
    const visit = (e: Expr): void => {
      if (this.isInputCall(e) && !seen.has(e)) {
        seen.add(e);
        const def = this.buildInputDef(e, declName.get(e), () => `input_${auto++}`, used);
        this.inputDefs.push(def);
        this.inputByExpr.set(e, def);
      }
      for (const c of exprChildren(e)) visit(c);
    };
    if (this.program.meta) for (const a of this.program.meta.args) visit(a.value);
    for (const s of this.program.body) for (const e of stmtExprs(s)) visit(e);
  }

  private buildInputDef(call: Extract<Expr, { type: 'call' }>, declName: string | undefined, autoId: () => string, used: Set<string>): InputDef {
    const kind = (call.callee as Extract<Expr, { type: 'member' }>).property as InputKind;
    if (kind !== 'num' && kind !== 'bool' && kind !== 'text' && kind !== 'source') {
      throw new RuntimeError(`unknown input kind 'input.${kind}'`, call.pos.line, call.pos.col);
    }
    const positional: Expr[] = [];
    const named = new Map<string, Expr>();
    for (const a of call.args) {
      if (a.name === null) positional.push(a.value);
      else named.set(a.name, a.value);
    }
    // Signature: input.<kind>(default, title?, min?, max?). Named args override positional.
    const constNum = (e: Expr | undefined, d: number): number => {
      if (!e) return d;
      const v = this.evalExpr(e, 0, null);
      return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const titleExpr = named.get('title') ?? positional[1];
    const title = titleExpr ? String(this.evalExpr(titleExpr, 0, null) ?? '') : '';

    let def: InputDef;
    if (kind === 'source') {
      const first = positional[0];
      const src = first && first.type === 'ident' && (PRICE_SOURCES as readonly string[]).includes(first.name) ? first.name : 'close';
      def = { id: '', kind, title, default: src, options: [...PRICE_SOURCES] };
    } else if (kind === 'bool') {
      def = { id: '', kind, title, default: positional[0] ? toBoolInput(this.evalExpr(positional[0], 0, null)) : false };
    } else if (kind === 'text') {
      def = { id: '', kind, title, default: positional[0] ? String(this.evalExpr(positional[0], 0, null) ?? '') : '' };
    } else {
      const min = named.has('min') ? constNum(named.get('min'), -Infinity) : positional[2] ? constNum(positional[2], -Infinity) : undefined;
      const max = named.has('max') ? constNum(named.get('max'), Infinity) : positional[3] ? constNum(positional[3], Infinity) : undefined;
      let dflt = constNum(positional[0], 0);
      if (min != null) dflt = Math.max(dflt, min); // a default below its own min would otherwise outrank an identical override
      if (max != null) dflt = Math.min(dflt, max);
      def = { id: '', kind, title, default: dflt };
      if (min != null) def.min = min;
      if (max != null) def.max = max;
      if (named.has('step')) def.step = constNum(named.get('step'), 1);
    }

    const base = declName || slug(title) || autoId();
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    def.id = id;
    if (!def.title) def.title = declName ?? id;
    return def;
  }

  /** Resolve an `input.*` call to its override (if any) or default; `source` reads the chosen series. */
  private resolveInput(e: Extract<Expr, { type: 'call' }>, bar: number): Value {
    const def = this.inputByExpr.get(e);
    if (!def) throw new RuntimeError('input.* must be a plain expression (not built dynamically)', e.pos.line, e.pos.col);
    const has = Object.prototype.hasOwnProperty.call(this.inputOverrides, def.id);
    if (def.kind === 'source') {
      const name = has ? String(this.inputOverrides[def.id]) : String(def.default);
      const c = this.candles[bar];
      return c ? priceOf(name, c) ?? c.close : null;
    }
    return has ? this.coerceInput(def, this.inputOverrides[def.id]!) : def.default;
  }

  private coerceInput(def: InputDef, v: number | boolean | string): Value {
    if (def.kind === 'num') {
      let n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return def.default;
      if (def.min != null) n = Math.max(n, def.min);
      if (def.max != null) n = Math.min(n, def.max);
      return n;
    }
    if (def.kind === 'bool') return toBoolInput(v);
    return String(v);
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
