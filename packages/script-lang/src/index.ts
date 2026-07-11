/**
 * PulseScript — SuperCharts' own chart-scripting language.
 *
 * Original design (see docs/pulsescript-design.md). Built incrementally:
 * lexer → parser → interpreter → standard library → editor. This entry point
 * re-exports each layer as it lands.
 */
export * from './tokens';
export * from './lexer';
export * from './ast';
export * from './parser';
export * from './interpreter';
// Standard-library tables (TA / MATH / constants) — the reference docs key their entries
// against these so a language change without a matching doc entry fails typecheck.
export { TA, MATH, MATH_CONSTS } from './stdlib';
export type { TaFn, TaOut, TaResult } from './stdlib';
