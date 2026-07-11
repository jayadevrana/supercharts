/**
 * Typed doc-entry model for the PulseScript API reference. The reference records are keyed
 * against the REAL stdlib objects (`Record<keyof typeof TA, DocEntry>` etc.). Because `TA`/`MATH`
 * are annotated `Record<string, …>` (so the interpreter can index them dynamically), the
 * completeness guard is a RUNTIME test, not typecheck: `tests/docs-reference.test.ts` fails if the
 * language gains or renames a function without a matching doc entry, and every `example` string is
 * executed through the real interpreter in that same test.
 */

export interface DocParam {
  name: string;
  type: string;
  desc: string;
}

export interface DocEntry {
  /** One-line signature, e.g. `ta.sma(source, length) → series`. */
  signature: string;
  /** One-sentence summary of what the function computes. */
  summary: string;
  /** Ordered parameter descriptions (empty for no-arg helpers). */
  params: DocParam[];
  /** What the call returns, e.g. `series` or `record { upper, lower, … }`. */
  returns: string;
  /** A minimal runnable PulseScript snippet — MUST execute clean through the interpreter. */
  example: string;
}
