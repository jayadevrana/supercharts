# PulseScript — SuperCharts' own chart-scripting language

> **This is the original design/build doc (Phase 6).** The language has since grown well past
> it — for what PulseScript can do today see **`docs/pulsescript-language.md`** (full
> reference) and **`docs/pulsescript-parity.md`** (audited capability matrix vs Pine Script +
> the next planned increments).

> **Original language.** PulseScript is designed from scratch for SuperCharts. It borrows only
> the *general, non-copyrightable concept* of a bar-by-bar series model (the same idea behind
> spreadsheets, kdb+, and every charting DSL) — **not** the syntax, keyword set, API surface, or
> identifiers of any existing product. Where a name is a universal domain term (`sma`, `rsi`,
> `close`) we use it because it's industry vocabulary, not because any one product owns it. The
> declaration/output/structure keywords are deliberately our own (`meta`, `draw`, `mark`, `fn`,
> `let`/`mut`, `when`, `#` comments, `{ }` blocks) so the language reads as SuperCharts', not a clone.
> Working name "PulseScript" / extension `.pulse` — rename freely.

## 1. Feel (a complete example)

```pulse
# EMA cross study — comments use '#'
meta(name: "EMA Cross", overlay: true)

let fast = ema(close, 12)
let slow = ema(close, 26)

draw line(fast, color: blue,   title: "Fast")
draw line(slow, color: orange, title: "Slow")

when crossOver(fast, slow) {
    mark buy at low   "Long"
}
when crossUnder(fast, slow) {
    mark sell at high "Short"
}
```

Distinct-from-everything choices: `#` line comments (no block comments), `{ }` blocks (not
indentation), `meta(...)` as the single declaration call, `draw <output>` for plots, `mark
buy/sell` for signals, `let`/`mut` for declare/mutable, `when <cond> { }` for event blocks.

## 2. Execution model

The script runs **once per bar**, oldest→newest, then live per tick. A bare identifier like
`close` is the current bar's value; `close[n]` looks back `n` bars (`[]` = history). `let` binds a
per-bar value; `persist` declares a variable initialised once that carries across bars
(accumulators, state). Outputs (`draw`, `mark`, `paint`) register a value for the current bar and
the renderer collects them across all bars.

## 3. Types

`num` (one numeric type — no int/float split; integer-ish ops via `floor`/`round`), `bool`,
`text`, `color`, `series<T>` (the implicit type of bar-varying values), `list<T>`, `map<K,V>`,
and records via `shape Name { field: type, ... }`. `none` is the absent value (our `na`); a `bool`
is never `none`. Truthiness is explicit (no numeric→bool coercion).

## 4. Grammar sketch (what the parser targets)

```
program     := metaStmt? statement*
metaStmt    := 'meta' '(' namedArgs ')'
statement   := letDecl | mutDecl | persistDecl | assign | whenBlock | ifStmt
             | forStmt | drawStmt | markStmt | fnDecl | exprStmt
letDecl     := 'let' IDENT '=' expr
mutDecl     := 'mut' IDENT '=' expr
persistDecl := 'persist' IDENT '=' expr
assign      := IDENT '=' expr                      # only valid for mut/persist
whenBlock   := 'when' expr block
ifStmt      := 'if' expr block ('else' (ifStmt | block))?
forStmt     := 'for' IDENT 'in' expr block | 'for' IDENT '=' expr 'to' expr block
fnDecl      := 'fn' IDENT '(' params ')' (block | '=' expr)
drawStmt    := 'draw' callExpr
markStmt    := 'mark' ('buy'|'sell'|'note') ('at' expr)? expr?
block       := '{' statement* '}'
expr        := ... precedence-climbing: or/and/not, == != < > <= >=, + - * / %, unary -,
               call, index [], member ., literals, ( )
```

## 5. Standard library (namespaced, built incrementally)

- core: `close open high low volume time barIndex` (series), `none`, `nz(x, d)`, `na(x)`.
- `math.*`: abs sign min max floor ceil round sqrt pow exp log sum avg.
- `ta.*`: sma ema wma rma rsi atr stdev highest lowest change crossOver crossUnder rising falling
  macd stoch vwap — **reuse the existing `@supercharts/indicators` package** for the math so the
  language and the chart indicators share one tested implementation.
- outputs: `line(series, color?, title?, width?)`, `hist(series, ...)`, `band(a, b, ...)`,
  `marker(...)`; `mark buy/sell/note`.
- inputs: `input.num(default, title, min?, max?)`, `input.bool`, `input.text`, `input.source` —
  surfaced as form controls in the editor.

## 6. Build roadmap (the /loop works down this; verify + commit each)

Package: `packages/script-lang` (`@supercharts/script-lang`), pure TS, unit-tested with Vitest.

1. **Lexer** — source → tokens (numbers, strings, idents, keywords, operators, `#` comments,
   `[]`, `{}`, `()`, newlines as statement separators). + tests. ← FIRST
2. **AST + Parser** — recursive-descent / precedence-climbing → typed AST nodes. Syntax errors
   carry line/col. + tests over the grammar in §4.
3. **Interpreter core** — bar-by-bar evaluator: a `Series` abstraction, `[]` history, `let`/`mut`/
   `persist` scoping, arithmetic/logic/`if`/`for`, `fn` calls. Runs over a `Candle[]` and returns
   per-bar output buffers. + tests (e.g. a script computing SMA matches `ta.sma`).
4. **Standard library binding** — wire `ta.*`/`math.*` to `@supercharts/indicators`; implement
   `close/open/...`, `crossOver`, etc. + `draw`/`mark` output capture. + tests.
5. **Inputs** — parse `input.*`, expose an input schema the editor renders as controls; feed values
   back into a run.
6. **Web: code terminal** — a panel/route in the app with a code editor (CodeMirror 6, lazy-loaded),
   Run button, a sample script, an errors/console pane, and an input panel. Wire run → interpreter →
   push `draw`/`mark` outputs onto the chart via the existing `IndicatorsLayer` (lines) + a markers
   layer. Browser-verify a real script plotting on BTCUSDT.
7. **Persistence + sharing** — save user scripts (API route + table), list/load, run on the active
   pane. (Reuses the layouts/preferences pattern.)
8. **Safety + limits** — execution timeout, bar/loop caps, no network/IO from scripts, clear runtime
   errors with line numbers. Hardening pass.

Guardrails for every loop iteration: never reproduce another product's API/identifiers; reuse
`@supercharts/indicators` for math; verify (typecheck + tests, and a browser screenshot once UI is
involved); commit small with the CLAUDE.md footer updated; if the dev servers are down (the laptop
sleeps and the USB SSD drops), kill stale procs by port and relaunch before verifying.
