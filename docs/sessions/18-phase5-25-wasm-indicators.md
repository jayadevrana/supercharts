# Session 18 — Phase 5 · #25 · WASM indicator pass (profile first — adopt only if it earns it)

> One session = this task only. Effort XL, **exploratory**. The deliverable is a DECISION backed by measurements, plus the fast path only if justified.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/18-phase5-25-wasm-indicators.md, then implement ONLY that task.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session — this session is ENTIRELY about measured numbers.
Verify (benchmarks + equivalence tests + typecheck), commit small, tick Phase 5 #25 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Decide with evidence whether hot indicator math should run in WASM — and if yes, ship it behind the existing `@supercharts/indicators` API with a JS fallback. **The API must not change: every consumer (charts, PulseScript stdlib, alert engine, backtester) stays untouched.**

## Phase A — Measure (mandatory, do first)

1. Write a benchmark harness (`tests/bench/` or a script): `computeAll` over 10k/50k/200k synthetic-but-realistic candles, plus the heaviest individual studies (EMA chains, Ichimoku, MACD-of-50k, footprint aggregation if client-side). Warm runs, median of ≥5, real timings pasted into the session log.
2. Profile where time actually goes (node --cpu-prof or simple hrtime sections). If `computeAll` over 50k candles is already < ~50ms median, **STOP: record the numbers, tick the task as "measured — WASM not justified", and end the session.** That is a successful outcome.

## Phase B — Only if Phase A justifies it

1. Pick the toolchain (Rust→wasm-pack or AssemblyScript — prefer whichever keeps the build simple in this pnpm monorepo; document the choice).
2. Port ONLY the measured hot loops into `packages/indicators-wasm` (new package). `@supercharts/indicators` gains an internal fast-path: feature-detect WASM, else identical JS path. Loading must be async-safe for the web bundle and inert under Node test runs unless explicitly enabled.
3. **Exact-equivalence tests**: for every ported function, WASM output ≡ JS output over randomized candle fixtures (epsilon ≤ 1e-9), pinned in Vitest like the backtester equivalence tests.
4. Re-run the Phase A benchmark with WASM on — report the before/after table. Adoption bar: ≥2× on the hot path at 50k candles, zero equivalence failures. Below the bar → keep the code on a branch, ship nothing, record the numbers.

## Hard rules

- No number without a command behind it — this session is the traceability rule's home game.
- The 246+ existing tests must stay green with WASM disabled AND enabled.
- Bundle-size delta reported (web build before/after).

## Done means

- [ ] Benchmark table (before / [after]) in the log with real medians  ·  [ ] decision recorded (adopt / not justified)  ·  [ ] if adopted: equivalence tests green + fallback proven  ·  [ ] #25 ticked + Recent log + one commit
