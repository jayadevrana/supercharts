import type { Candle } from '@supercharts/types';
import { priceFromCandle, type PriceSource } from '@supercharts/indicators';
import type { Arg, Expr, MarkKind, Program, Stmt } from './ast';
import { parse } from './parser';
import { MATH, MATH_CONSTS, TA, type TaFn, type TaResult } from './stdlib';

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

export type Value = number | boolean | string | null | Value[] | RecordValue;
/** A record value — the result of a multi-output study (e.g. `.upper` / `.lower` fields). */
export interface RecordValue {
  [key: string]: Value;
}

export type PlotKind = 'line' | 'hist' | 'band' | 'area' | 'steps' | 'dots';
export type PlotDash = 'solid' | 'dashed' | 'dotted';
export interface Plot {
  title: string;
  color: string | null;
  kind: PlotKind;
  /** Line width / dot radius in px (style: `width:` named arg). */
  width?: number;
  /** Stroke style (`style: "dashed"` / `"dotted"`). */
  dash?: PlotDash;
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
/** `draw level(y, …)` — a constant horizontal line (reference level). */
export interface LevelDef {
  y: number;
  title: string | null;
  color: string | null;
  dash: PlotDash;
}
export type MarkerShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'cross'
  | 'triangleUp'
  | 'triangleDown'
  | 'arrowUp'
  | 'arrowDown'
  | 'flag';
/** `draw marker(cond, …)` — a per-bar shape (condition-gated), above/below the bar or at a price. */
export interface ShapeMark {
  bar: number;
  shape: MarkerShape;
  place: 'above' | 'below';
  /** Explicit y — overrides `place` when set. */
  price: number | null;
  color: string | null;
  text: string | null;
  size: number;
}
/** An `alert("…")` raised while the script ran (collected, shown in the console / tester). */
export interface AlertEvent {
  bar: number;
  text: string;
}
export type InputKind = 'num' | 'bool' | 'text' | 'source' | 'select' | 'color';
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
  /** Constant horizontal reference lines (`draw level`). */
  levels: LevelDef[];
  /** Condition-gated per-bar shapes (`draw marker`). */
  shapes: ShapeMark[];
  /** Per-bar background colour (`paint bg`), null = unpainted. */
  bgFills: (string | null)[];
  /** Per-bar candle tint (`paint candles`), null = untinted. */
  barTints: (string | null)[];
  /** Alerts raised via `alert("…")`. */
  alerts: AlertEvent[];
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
const isList = (v: Value): v is Value[] => Array.isArray(v);
const isRecord = (v: Value): v is RecordValue => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);

/** Control-flow signal for `break` / `continue` — caught by the enclosing loop, never escapes a run. */
class LoopSignal {
  constructor(
    public kind: 'break' | 'continue',
    public pos: { line: number; col: number },
  ) {}
}

/** The price-series names a script (and `input.source`) can read off each candle. */
export const PRICE_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'] as const;
/** Read a named price series off a candle: the indicators package's price math, plus `volume`/`hlcc4`. */
function priceOf(name: string, c: Candle): number | null {
  if (name === 'volume') return c.volume;
  if (name === 'hlcc4') return (c.high + c.low + c.close + c.close) / 4;
  return (PRICE_SOURCES as readonly string[]).includes(name) ? priceFromCandle(c, name as PriceSource) : null;
}
/** Bar clock/context names readable on any bar (UTC fields of the bar's open time + run shape). */
const CONTEXT_NAMES = [
  'year',
  'month',
  'day',
  'weekday',
  'hour',
  'minute',
  'second',
  'barCount',
  'lastBarIndex',
  'isFirstBar',
  'isLastBar',
] as const;
/** Identifiers whose value at a given bar is fixed by the candle alone (no execution-built state). */
const STABLE_PRICE_NAMES = new Set<string>([...PRICE_SOURCES, ...CONTEXT_NAMES, 'barIndex', 'time', 'none']);
/** Built-in namespaces — these idents never resolve as values, only as `ns.fn(...)` calls. */
const NAMESPACE_NAMES = new Set(['math', 'ta', 'input']);
/** The date-time field names (subset of CONTEXT_NAMES that need a Date). */
const DT_NAMES = new Set(['year', 'month', 'day', 'weekday', 'hour', 'minute', 'second']);
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** Coerce an input default/override to a bool consistently (true / 1 / "true" / "1"). */
const toBoolInput = (v: Value): boolean => v === true || v === 1 || v === 'true' || v === '1';

export interface RunOptions {
  /** Hard cap on total loop iterations across the run (runaway guard). Default 5,000,000. */
  maxLoopSteps?: number;
  /** Wall-clock execution budget in ms — the run aborts with a line-numbered error past it. Default 2000. */
  timeoutMs?: number;
  /** Reject inputs with more than this many bars (defensive; the chart sends ≤ a few thousand). Default 50,000. */
  maxBars?: number;
  /** Override values for declared `input.*` controls, keyed by input id. */
  inputs?: Record<string, number | boolean | string>;
  /** The chart timeframe of the candles (e.g. "1m", "1h") — required by `onTf` multi-timeframe reads. */
  interval?: string;
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
    case 'ternary':
      return [e.cond, e.then, e.else];
    case 'list':
      return e.items;
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
    case 'while':
      yield s.cond;
      for (const t of s.body) yield* stmtExprs(t);
      return;
    case 'break':
    case 'continue':
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
    case 'paint':
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
  /** `draw level` keyed by call site — re-executing per bar overwrites (last value wins). */
  private levels = new Map<Expr, LevelDef>();
  private shapes: ShapeMark[] = [];
  private bgFills: (string | null)[] = [];
  private barTints: (string | null)[] = [];
  private alerts: AlertEvent[] = [];
  private meta: Record<string, Value> = {};
  private i = 0; // current bar
  private loopSteps = 0;
  private readonly maxLoopSteps: number;
  private readonly timeoutMs: number;
  private readonly maxBars: number;
  /** Wall-clock abort time (epoch ms), armed when the run starts. */
  private deadline = Infinity;
  /** Source position of the statement currently executing — surfaced in timeout/cap errors. */
  private lastPos: { line: number; col: number } = { line: 1, col: 1 };
  /** Per-call-site cache of a series argument's values, grown bar-by-bar (locals-free calls only). */
  private seriesCache = new Map<Expr, { arr: number[]; upTo: number }>();
  /** Per-call-site cache of a stdlib call's output, valid for the current top bar (per-bar fallback). */
  private callCache = new Map<Expr, { at: number; out: TaResult }>();
  /** series:0 studies (atr/vwap/macd/stoch) depend only on candles + params → one result per (fn, params) for the whole run. */
  private taParamCache = new Map<string, TaResult>();
  /** Per-call-site cache for a bar-invariant series-based call → computed once over the full range, then just indexed. */
  private taRunCache = new Map<Expr, TaResult>();
  /** Memoised "is this ta call bar-invariant (cache-safe)?" decision, per call site. */
  private taStable = new Map<Expr, boolean>();
  /** Every name the script binds (decls / fn names+params / loop vars) — a reference to one of these is not a pure candle read. */
  private declaredNames = new Set<string>();
  /** Per-openTime Date memo for the date-time built-ins (year/month/…): avoids a Date per lookup. */
  private dtMemo: { at: number; d: Date } = { at: NaN, d: new Date(0) };
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
    this.timeoutMs = opts.timeoutMs ?? 2_000;
    this.maxBars = opts.maxBars ?? 50_000;
    this.inputOverrides = opts.inputs ?? {};
  }

  run(): RunResult {
    if (this.candles.length > this.maxBars) {
      throw new RuntimeError(`input exceeds the ${this.maxBars}-bar safety limit (${this.candles.length} bars)`, 1, 1);
    }
    this.deadline = Date.now() + this.timeoutMs;
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
      this.checkDeadline();
      try {
        for (const s of this.program.body) this.execStmt(s, null);
      } catch (e) {
        if (e instanceof LoopSignal) throw new RuntimeError(`'${e.kind}' outside a loop`, e.pos.line, e.pos.col);
        throw e;
      }
    }
    return {
      meta: this.meta,
      inputs: this.inputDefs,
      plots: this.plotOrder.map((t) => this.plots.get(t)!),
      marks: this.marks,
      levels: [...this.levels.values()],
      shapes: this.shapes,
      bgFills: this.bgFills,
      barTints: this.barTints,
      alerts: this.alerts,
    };
  }

  // ---- statements ----
  private execStmt(s: Stmt, locals: Map<string, Value> | null): void {
    this.lastPos = s.pos; // so a timeout abort can point near where it ran
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
          if (this.runLoopBody(s.body, inner)) break;
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
          if (this.runLoopBody(s.body, inner)) break;
        }
        return;
      }
      case 'while': {
        const inner = locals ?? new Map<string, Value>();
        while (this.truthy(this.evalExpr(s.cond, this.i, inner))) {
          this.tick(s.pos);
          if (this.runLoopBody(s.body, inner)) break;
        }
        return;
      }
      case 'break':
        throw new LoopSignal('break', s.pos);
      case 'continue':
        throw new LoopSignal('continue', s.pos);
      case 'draw':
        this.evalDraw(s.call, locals);
        return;
      case 'paint':
        this.evalPaint(s.call, locals);
        return;
      case 'mark': {
        const price = s.at ? this.toNumOrNull(this.evalExpr(s.at, this.i, locals)) : this.candles[this.i]!.close;
        const tv = s.text ? this.evalExpr(s.text, this.i, locals) : null;
        const text = s.text ? (isNone(tv) ? '' : this.display(tv)) : null;
        this.marks.push({ bar: this.i, kind: s.kind, price, text });
        return;
      }
      case 'expr':
        this.evalExpr(s.expr, this.i, locals);
        return;
    }
  }

  /** Run one loop iteration's statements; returns true when a `break` unwound to this loop. */
  private runLoopBody(body: Stmt[], locals: Map<string, Value>): boolean {
    try {
      for (const st of body) this.execStmt(st, locals);
    } catch (e) {
      if (e instanceof LoopSignal) return e.kind === 'break';
      throw e;
    }
    return false;
  }

  private tick(pos: { line: number; col: number }): void {
    this.loopSteps += 1;
    if (this.loopSteps > this.maxLoopSteps) {
      throw new RuntimeError('loop step limit exceeded', pos.line, pos.col);
    }
    // Wall-clock check every 4096 steps — cheap, but bounds a tight loop that isn't step-capped yet.
    if ((this.loopSteps & 4095) === 0) this.checkDeadline(pos);
  }

  /** Abort the run if it has blown its wall-clock budget — stops a pathological script hanging the UI. */
  private checkDeadline(pos: { line: number; col: number } = this.lastPos): void {
    if (Date.now() > this.deadline) {
      throw new RuntimeError(`execution timed out (over ${this.timeoutMs}ms)`, pos.line, pos.col);
    }
  }

  /** Plot-buffer kinds a `draw` statement can produce. */
  private static readonly DRAW_KINDS: ReadonlySet<string> = new Set(['line', 'hist', 'band', 'area', 'steps', 'dots']);
  private static readonly MARKER_SHAPES: ReadonlySet<string> = new Set([
    'circle',
    'square',
    'diamond',
    'cross',
    'triangleUp',
    'triangleDown',
    'arrowUp',
    'arrowDown',
    'flag',
  ]);

  /**
   * `draw <kind>(value, …)` — series plots (`line/hist/band/area/steps/dots`, with `width:` /
   * `style: "dashed"|"dotted"` named args), constant `level(y, …)` reference lines, and
   * condition-gated `marker(cond, …)` shapes.
   */
  private evalDraw(call: Expr, locals: Map<string, Value> | null): void {
    if (call.type !== 'call' || call.callee.type !== 'ident') {
      throw new RuntimeError(
        "draw expects line(...), hist(...), band(...), area(...), steps(...), dots(...), level(...) or marker(...)",
        call.pos.line,
        call.pos.col,
      );
    }
    const name = call.callee.name;
    if (name === 'level') return this.evalLevel(call, locals);
    if (name === 'marker') return this.evalMarker(call, locals);
    if (!Interpreter.DRAW_KINDS.has(name)) {
      throw new RuntimeError(
        `unknown draw output '${name}' — use line/hist/band/area/steps/dots/level/marker`,
        call.pos.line,
        call.pos.col,
      );
    }
    const kind = name as PlotKind;
    let title: string | null = null;
    let color: string | null = null;
    let width: number | undefined;
    let dash: PlotDash | undefined;
    const positional: Arg[] = [];
    for (const a of call.args) {
      if (a.name === 'title') title = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'color') color = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'width') width = this.toNumOrNull(this.evalExpr(a.value, this.i, locals)) ?? undefined;
      else if (a.name === 'style') dash = this.toDash(this.evalExpr(a.value, this.i, locals), a.pos);
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
    if (width != null && plot.width == null) plot.width = width;
    if (dash && !plot.dash) plot.dash = dash;
    plot.values[this.i] = this.toNumOrNull(this.evalExpr(positional[0]!.value, this.i, locals));
    if (kind === 'band') {
      (plot.values2 ??= [])[this.i] = this.toNumOrNull(this.evalExpr(positional[1]!.value, this.i, locals));
    }
  }

  private toDash(v: Value, pos: { line: number; col: number }): PlotDash {
    const s = String(v ?? 'solid');
    if (s === 'solid' || s === 'dashed' || s === 'dotted') return s;
    throw new RuntimeError(`style must be "solid", "dashed" or "dotted" (got "${s}")`, pos.line, pos.col);
  }

  /** `draw level(y, color:, title:, style:)` — constant horizontal line; last value wins per call site. */
  private evalLevel(call: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null): void {
    let y: number | null = null;
    let title: string | null = null;
    let color: string | null = null;
    let dash: PlotDash = 'dashed';
    for (const a of call.args) {
      if (a.name === 'title') title = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'color') color = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'style') dash = this.toDash(this.evalExpr(a.value, this.i, locals), a.pos);
      else if (a.name === null && y === null) y = this.toNumOrNull(this.evalExpr(a.value, this.i, locals));
    }
    if (y === null) return; // a none level on this bar — keep any previous value
    this.levels.set(call, { y, title, color, dash });
  }

  /** `draw marker(cond, at: "above"|"below"|price, shape:, color:, text:, size:)`. */
  private evalMarker(call: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null): void {
    const positional = call.args.filter((a) => a.name === null);
    if (positional.length < 1) {
      throw new RuntimeError('draw marker(...) needs a condition argument', call.pos.line, call.pos.col);
    }
    if (!this.truthy(this.evalExpr(positional[0]!.value, this.i, locals))) return;
    let place: 'above' | 'below' = 'above';
    let price: number | null = null;
    let shape: MarkerShape = 'triangleUp';
    let color: string | null = null;
    let text: string | null = null;
    let size = 4;
    for (const a of call.args) {
      if (a.name === 'at') {
        const v = this.evalExpr(a.value, this.i, locals);
        if (v === 'above' || v === 'below') place = v;
        else {
          const n = this.toNumOrNull(v);
          if (n === null) return; // marker at none → skip this bar
          price = n;
        }
      } else if (a.name === 'shape') {
        const s = String(this.evalExpr(a.value, this.i, locals) ?? '');
        if (!Interpreter.MARKER_SHAPES.has(s)) {
          throw new RuntimeError(
            `unknown marker shape "${s}" (use ${[...Interpreter.MARKER_SHAPES].join('/')})`,
            a.pos.line,
            a.pos.col,
          );
        }
        shape = s as MarkerShape;
      } else if (a.name === 'color') color = String(this.evalExpr(a.value, this.i, locals) ?? '');
      else if (a.name === 'text') {
        const tv = this.evalExpr(a.value, this.i, locals);
        text = isNone(tv) ? null : this.display(tv);
      } else if (a.name === 'size') size = Math.max(1, Math.min(24, num(this.evalExpr(a.value, this.i, locals)) || 4));
    }
    this.shapes.push({ bar: this.i, shape, place, price, color, text, size });
  }

  /** `paint bg(color)` / `paint candles(color)` — per-bar colour buffers (none clears nothing). */
  private evalPaint(call: Expr, locals: Map<string, Value> | null): void {
    if (call.type !== 'call' || call.callee.type !== 'ident' || !['bg', 'candles'].includes(call.callee.name)) {
      throw new RuntimeError("paint expects 'bg(color)' or 'candles(color)'", call.pos.line, call.pos.col);
    }
    const target = call.callee.name as 'bg' | 'candles';
    const first = call.args.find((a) => a.name === null);
    if (!first) throw new RuntimeError(`paint ${target}(...) needs a color`, call.pos.line, call.pos.col);
    const v = this.evalExpr(first.value, this.i, locals);
    if (isNone(v)) return;
    const color = String(v);
    if (target === 'bg') this.bgFills[this.i] = color;
    else this.barTints[this.i] = color;
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
      case 'ternary':
        return this.truthy(this.evalExpr(e.cond, bar, locals))
          ? this.evalExpr(e.then, bar, locals)
          : this.evalExpr(e.else, bar, locals);
      case 'list':
        return e.items.map((it) => this.evalExpr(it, bar, locals));
      case 'call':
        return this.evalCall(e, bar, locals);
      case 'member': {
        // Namespaces are call-only (except `math.pi`-style constants); records expose fields.
        if (e.object.type === 'ident' && NAMESPACE_NAMES.has(e.object.name)) {
          if (e.object.name === 'math' && e.property in MATH_CONSTS) return MATH_CONSTS[e.property]!;
          throw new RuntimeError(
            `namespace member '.${e.property}' must be called, e.g. ta.sma(close, 20)`,
            e.pos.line,
            e.pos.col,
          );
        }
        const obj = this.evalExpr(e.object, bar, locals);
        if (isNone(obj)) return null; // none propagates through field reads
        if (isRecord(obj)) {
          if (!(e.property in obj)) {
            throw new RuntimeError(
              `no field '.${e.property}' on this value (fields: ${Object.keys(obj).join(', ')})`,
              e.pos.line,
              e.pos.col,
            );
          }
          return obj[e.property]!;
        }
        throw new RuntimeError(
          `'.${e.property}' is not a field — methods need (), e.g. .${e.property}()`,
          e.pos.line,
          e.pos.col,
        );
      }
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
      const fn = e.callee.property;
      if (e.callee.object.type === 'ident' && NAMESPACE_NAMES.has(e.callee.object.name)) {
        const ns = e.callee.object.name;
        if (ns === 'math') return this.callMath(fn, e, bar, locals);
        if (ns === 'ta') return this.callTa(fn, e, bar, locals);
        return this.resolveInput(e, bar);
      }
      // Value method — evaluate the receiver and dispatch on its runtime type.
      const recv = this.evalExpr(e.callee.object, bar, locals);
      const args = e.args.map((a) => this.evalExpr(a.value, bar, locals));
      return this.callMethod(recv, fn, args, e);
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
    if (name === 'text') {
      // text(v, decimals?) — render any value as text; decimals fixes a number's precision.
      const v = e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null;
      const dec = e.args[1] ? num(this.evalExpr(e.args[1].value, bar, locals)) : NaN;
      if (typeof v === 'number' && Number.isFinite(dec)) return v.toFixed(Math.max(0, Math.min(12, Math.trunc(dec))));
      return this.display(v);
    }
    if (name === 'parseNum') {
      const v = e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null;
      const n = typeof v === 'string' ? Number(v.trim()) : num(v);
      return Number.isFinite(n) ? n : null;
    }
    if (name === 'alert') {
      // alert("message") — collected per bar; gate with `when cond { alert(...) }`.
      const v = e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null;
      if (bar === this.i) this.alerts.push({ bar, text: isNone(v) ? '' : this.display(v) });
      return null;
    }
    if (name === 'rgb' || name === 'rgba') {
      const ch = (idx: number, lo: number, hi: number, d: number): number => {
        const n = e.args[idx] ? num(this.evalExpr(e.args[idx]!.value, bar, locals)) : d;
        return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : d));
      };
      const r = Math.round(ch(0, 0, 255, 0));
      const g = Math.round(ch(1, 0, 255, 0));
      const b = Math.round(ch(2, 0, 255, 0));
      if (name === 'rgb') return `rgb(${r},${g},${b})`;
      return `rgba(${r},${g},${b},${ch(3, 0, 1, 1)})`;
    }
    if (name === 'repeat') {
      // repeat(value, count) — build a list of `count` copies (each bar gets a fresh list).
      const v = e.args[0] ? this.evalExpr(e.args[0].value, bar, locals) : null;
      const count = Math.max(0, Math.trunc(num(e.args[1] ? this.evalExpr(e.args[1].value, bar, locals) : 0)));
      if (count > 100_000) throw new RuntimeError('repeat() count exceeds the 100k safety cap', e.pos.line, e.pos.col);
      return new Array<Value>(count).fill(v);
    }
    if (TA[name]) return this.callTa(name, e, bar, locals);
    throw new RuntimeError(`unknown function '${name}'`, e.pos.line, e.pos.col);
  }

  /** Methods on list / text values — `xs.size()`, `s.upper()`, … Mutators return the list for chaining. */
  private callMethod(recv: Value, name: string, args: Value[], e: Extract<Expr, { type: 'call' }>): Value {
    const err = (msg: string): never => {
      throw new RuntimeError(msg, e.pos.line, e.pos.col);
    };
    if (isList(recv)) {
      const idx = (v: Value): number => Math.trunc(num(v));
      const numericItems = (): number[] => recv.map((x) => num(x)).filter((n) => Number.isFinite(n));
      switch (name) {
        case 'size':
          return recv.length;
        case 'at': {
          const i = idx(args[0] ?? null);
          return i >= 0 && i < recv.length ? recv[i]! : null;
        }
        case 'first':
          return recv.length ? recv[0]! : null;
        case 'last':
          return recv.length ? recv[recv.length - 1]! : null;
        case 'push':
          recv.push(args[0] ?? null);
          return recv;
        case 'pop':
          return recv.length ? recv.pop()! : null;
        case 'shift':
          return recv.length ? recv.shift()! : null;
        case 'unshift':
          recv.unshift(args[0] ?? null);
          return recv;
        case 'set': {
          const i = idx(args[0] ?? null);
          if (i < 0 || i >= recv.length) err(`.set(${i}, …) is out of range (size ${recv.length})`);
          recv[i] = args[1] ?? null;
          return recv;
        }
        case 'insert': {
          const i = Math.max(0, Math.min(recv.length, idx(args[0] ?? null)));
          recv.splice(i, 0, args[1] ?? null);
          return recv;
        }
        case 'removeAt': {
          const i = idx(args[0] ?? null);
          if (i < 0 || i >= recv.length) return null;
          return recv.splice(i, 1)[0]!;
        }
        case 'clear':
          recv.length = 0;
          return recv;
        case 'copy':
          return [...recv];
        case 'contains':
          return recv.some((x) => this.equals(x, args[0] ?? null));
        case 'indexOf': {
          const i = recv.findIndex((x) => this.equals(x, args[0] ?? null));
          return i >= 0 ? i : null;
        }
        case 'slice': {
          const from = idx(args[0] ?? 0);
          const to = args.length > 1 ? idx(args[1]!) : recv.length;
          return recv.slice(Math.max(0, from), Math.max(0, to));
        }
        case 'join':
          return recv.map((x) => this.display(x)).join(typeof args[0] === 'string' ? args[0] : ', ');
        case 'sum': {
          const xs = numericItems();
          return xs.length ? xs.reduce((s, x) => s + x, 0) : null;
        }
        case 'avg': {
          const xs = numericItems();
          return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
        }
        case 'min': {
          const xs = numericItems();
          return xs.length ? Math.min(...xs) : null;
        }
        case 'max': {
          const xs = numericItems();
          return xs.length ? Math.max(...xs) : null;
        }
        case 'sort': {
          const desc = args[0] === true;
          recv.sort((a, b) => {
            const an = num(a);
            const bn = num(b);
            const cmp =
              Number.isFinite(an) && Number.isFinite(bn)
                ? an - bn
                : String(this.display(a)).localeCompare(String(this.display(b)));
            return desc ? -cmp : cmp;
          });
          return recv;
        }
        case 'reverse':
          recv.reverse();
          return recv;
        default:
          err(`lists have no method '.${name}()'`);
      }
    }
    if (typeof recv === 'string') {
      const s = recv;
      const str = (v: Value): string => (typeof v === 'string' ? v : this.display(v));
      switch (name) {
        case 'len':
          return s.length;
        case 'upper':
          return s.toUpperCase();
        case 'lower':
          return s.toLowerCase();
        case 'trim':
          return s.trim();
        case 'contains':
          return s.includes(str(args[0] ?? ''));
        case 'startsWith':
          return s.startsWith(str(args[0] ?? ''));
        case 'endsWith':
          return s.endsWith(str(args[0] ?? ''));
        case 'indexOf': {
          const i = s.indexOf(str(args[0] ?? ''));
          return i >= 0 ? i : null;
        }
        case 'replace':
          return s.split(str(args[0] ?? '')).join(str(args[1] ?? ''));
        case 'split':
          return s.split(str(args[0] ?? ',')) as Value[];
        case 'slice': {
          const from = Math.trunc(num(args[0] ?? 0));
          const to = args.length > 1 ? Math.trunc(num(args[1]!)) : s.length;
          return s.slice(from, to);
        }
        case 'repeat': {
          const n = Math.max(0, Math.min(10_000, Math.trunc(num(args[0] ?? 0))));
          return s.repeat(n);
        }
        default:
          err(`text has no method '.${name}()'`);
      }
    }
    if (isNone(recv)) return null; // none propagates through method calls
    return err(`'.${name}()' — this value has no methods (only lists and text do)`);
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
    try {
      for (const st of fn.body) {
        if (st.type === 'expr') result = this.evalExpr(st.expr, bar, scope);
        else this.execStmt(st, scope);
      }
    } catch (err) {
      if (err instanceof LoopSignal) throw new RuntimeError(`'${err.kind}' outside a loop`, err.pos.line, err.pos.col);
      throw err;
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
    return this.pickTa(this.taOutput(fn, spec, e, locals), bar);
  }

  /** Index a study's full output at one bar — a record value for multi-output studies. */
  private pickTa(out: TaResult, bar: number): Value {
    if (Array.isArray(out)) {
      const r = out[bar];
      if (r == null) return null;
      return typeof r === 'boolean' ? r : this.finiteOrNull(r);
    }
    const rec: RecordValue = {};
    for (const key of Object.keys(out)) {
      const r = out[key]![bar];
      rec[key] = r == null ? null : typeof r === 'boolean' ? r : this.finiteOrNull(r);
    }
    return rec;
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
  private taOutput(fn: string, spec: TaFn, e: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null): TaResult {
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
  private computeTa(fn: string, spec: TaFn, e: Extract<Expr, { type: 'call' }>, locals: Map<string, Value> | null, upTo: number): TaResult {
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
      case 'ternary':
        return this.isStableSeries(e.cond) && this.isStableSeries(e.then) && this.isStableSeries(e.else);
      case 'index':
        return this.isStableSeries(e.object) && this.isConst(e.index);
      case 'call':
        return this.isStableCall(e, false);
      case 'member':
        return this.isMathConst(e);
      case 'list':
        return false;
    }
  }

  /** `math.pi` / `math.e` / `math.phi` — constant member reads. */
  private isMathConst(e: Extract<Expr, { type: 'member' }>): boolean {
    return e.object.type === 'ident' && e.object.name === 'math' && e.property in MATH_CONSTS;
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
      case 'ternary':
        return this.isConst(e.cond) && this.isConst(e.then) && this.isConst(e.else);
      case 'call':
        return this.isStableCall(e, true);
      case 'member':
        return this.isMathConst(e);
      case 'ident': // price sources / barIndex / globals all vary per bar
      case 'index':
      case 'list':
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
          case 'while':
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
    // Run-shape context (bar clock):
    switch (name) {
      case 'barCount':
        return this.candles.length;
      case 'lastBarIndex':
        return this.candles.length - 1;
      case 'isFirstBar':
        return bar === 0;
      case 'isLastBar':
        return bar === this.candles.length - 1;
    }
    // Date-time fields of the bar's open time, in UTC (documented — not exchange-local).
    if (DT_NAMES.has(name)) {
      if (this.dtMemo.at !== c.openTime) this.dtMemo = { at: c.openTime, d: new Date(c.openTime) };
      const d = this.dtMemo.d;
      switch (name) {
        case 'year':
          return d.getUTCFullYear();
        case 'month':
          return d.getUTCMonth() + 1;
        case 'day':
          return d.getUTCDate();
        case 'weekday':
          return ((d.getUTCDay() + 6) % 7) + 1; // ISO: Mon=1 … Sun=7
        case 'hour':
          return d.getUTCHours();
        case 'minute':
          return d.getUTCMinutes();
        case 'second':
          return d.getUTCSeconds();
      }
    }
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
    if (kind !== 'num' && kind !== 'bool' && kind !== 'text' && kind !== 'source' && kind !== 'select' && kind !== 'color') {
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
    } else if (kind === 'select') {
      // input.select(default, title?, options: ["a", "b", …]) — a dropdown of fixed choices.
      const optExpr = named.get('options');
      const optVal = optExpr ? this.evalExpr(optExpr, 0, null) : null;
      const options = isList(optVal) ? optVal.map((o) => String(o ?? '')).filter((o) => o.length > 0) : [];
      if (options.length === 0) {
        throw new RuntimeError(
          `input.select needs an options list — e.g. input.select("fast", "Mode", options: ["fast", "slow"])`,
          call.pos.line,
          call.pos.col,
        );
      }
      const rawDefault = positional[0] ? String(this.evalExpr(positional[0], 0, null) ?? '') : options[0]!;
      def = { id: '', kind, title, default: options.includes(rawDefault) ? rawDefault : options[0]!, options };
    } else if (kind === 'color') {
      def = { id: '', kind, title, default: positional[0] ? String(this.evalExpr(positional[0], 0, null) ?? '#38bdf8') : '#38bdf8' };
    } else {
      const min = named.has('min') ? constNum(named.get('min'), -Infinity) : positional[2] ? constNum(positional[2], -Infinity) : undefined;
      const max = named.has('max') ? constNum(named.get('max'), Infinity) : positional[3] ? constNum(positional[3], Infinity) : undefined;
      // A non-numeric default is ALWAYS a script mistake — usually the habit (from other
      // platforms) of writing the title first. Guessing a default here silently changes
      // every number the strategy produces, so fail loud with the correct signature.
      let dflt = 0;
      if (positional[0]) {
        const v = this.evalExpr(positional[0], 0, null);
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new RuntimeError(
            `input.num default must be a number — the signature is input.num(default, title?, min:, max:), e.g. input.num(9, "Fast EMA", min: 2)`,
            call.pos.line,
            call.pos.col,
          );
        }
        dflt = v;
      }
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
    if (def.kind === 'select') {
      // An override outside the declared options falls back to the default (defensive).
      const s = String(v);
      return def.options?.includes(s) ? s : def.default;
    }
    return String(v);
  }

  private truthy(v: Value): boolean {
    return v === true;
  }
  private equals(a: Value, b: Value): boolean {
    if (isNone(a) || isNone(b)) return isNone(a) && isNone(b);
    if (isList(a) && isList(b)) return a.length === b.length && a.every((v, i) => this.equals(v, b[i]!));
    if (isList(a) || isList(b)) return false;
    if (isRecord(a) && isRecord(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => k in b && this.equals(a[k]!, b[k]!));
    }
    if (isRecord(a) || isRecord(b)) return false;
    return a === b;
  }
  private display(v: Value): string {
    if (isNone(v)) return 'none';
    if (isList(v)) return `[${v.map((x) => this.display(x)).join(', ')}]`;
    if (isRecord(v)) {
      return `{${Object.entries(v)
        .map(([k, x]) => `${k}: ${this.display(x)}`)
        .join(', ')}}`;
    }
    return String(v);
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
