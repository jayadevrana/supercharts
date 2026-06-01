import { describe, it, expect } from 'vitest';
import { parse, ParseError } from '../packages/script-lang/src/parser';

describe('PulseScript parser', () => {
  it('parses a meta declaration with named args', () => {
    const p = parse('meta(name: "EMA Cross", overlay: true)');
    expect(p.meta).toBeTruthy();
    expect(p.meta!.args.map((a) => a.name)).toEqual(['name', 'overlay']);
    expect(p.meta!.args[0]!.value).toMatchObject({ type: 'str', value: 'EMA Cross' });
    expect(p.meta!.args[1]!.value).toMatchObject({ type: 'bool', value: true });
  });

  it('respects arithmetic precedence (* binds tighter than +)', () => {
    const p = parse('let x = 1 + 2 * 3');
    const decl = p.body[0]!;
    expect(decl).toMatchObject({ type: 'decl', kind: 'let', name: 'x' });
    const v = (decl as Extract<typeof decl, { type: 'decl' }>).value;
    expect(v).toMatchObject({
      type: 'binary',
      op: '+',
      left: { type: 'num', value: 1 },
      right: { type: 'binary', op: '*', left: { type: 'num', value: 2 }, right: { type: 'num', value: 3 } },
    });
  });

  it('parses member access, history index, and calls', () => {
    const p = parse('let s = ta.sma(close[1], 5)');
    const v = (p.body[0] as { value: unknown }).value as Record<string, unknown>;
    expect(v).toMatchObject({
      type: 'call',
      callee: { type: 'member', property: 'sma', object: { type: 'ident', name: 'ta' } },
    });
    const args = (v as { args: Array<{ value: Record<string, unknown> }> }).args;
    expect(args[0]!.value).toMatchObject({ type: 'index', object: { type: 'ident', name: 'close' } });
    expect(args[1]!.value).toMatchObject({ type: 'num', value: 5 });
  });

  it('parses if / else blocks', () => {
    const p = parse('if a > b {\n  draw line(a)\n} else {\n  draw line(b)\n}');
    const s = p.body[0]!;
    expect(s.type).toBe('if');
    const ifs = s as Extract<typeof s, { type: 'if' }>;
    expect(ifs.cond).toMatchObject({ type: 'binary', op: '>' });
    expect(ifs.then[0]).toMatchObject({ type: 'draw' });
    expect(ifs.else?.[0]).toMatchObject({ type: 'draw' });
  });

  it('parses a when block with mark buy at <expr> <text>', () => {
    const p = parse('when crossOver(f, s) {\n  mark buy at low "Long"\n}');
    const w = p.body[0] as Extract<(typeof p.body)[number], { type: 'when' }>;
    expect(w.type).toBe('when');
    const m = w.body[0] as Extract<(typeof w.body)[number], { type: 'mark' }>;
    expect(m).toMatchObject({ type: 'mark', kind: 'buy' });
    expect(m.at).toMatchObject({ type: 'ident', name: 'low' });
    expect(m.text).toMatchObject({ type: 'str', value: 'Long' });
  });

  it('parses both for forms', () => {
    expect(parse('for i = 0 to 10 {\n  draw line(i)\n}').body[0]).toMatchObject({
      type: 'forRange',
      varName: 'i',
    });
    expect(parse('for v in xs {\n  draw line(v)\n}').body[0]).toMatchObject({
      type: 'forIn',
      varName: 'v',
    });
  });

  it('parses fn with expression body and block body', () => {
    expect(parse('fn diff(a, b) = a - b').body[0]).toMatchObject({
      type: 'fn',
      name: 'diff',
      ret: { type: 'binary', op: '-' },
    });
    const blk = parse('fn z(x) {\n  let m = x\n  m\n}').body[0] as Extract<
      ReturnType<typeof parse>['body'][number],
      { type: 'fn' }
    >;
    expect(blk.params[0]).toMatchObject({ name: 'x' });
    expect(blk.body.length).toBe(2);
  });

  it('parses logical precedence: a and b or not c', () => {
    const v = (parse('let r = a and b or not c').body[0] as { value: unknown }).value;
    expect(v).toMatchObject({
      type: 'logical',
      op: 'or',
      left: { type: 'logical', op: 'and' },
      right: { type: 'unary', op: 'not' },
    });
  });

  it('parses reassignment vs declaration', () => {
    expect(parse('x = 5').body[0]).toMatchObject({ type: 'assign', name: 'x' });
    expect(parse('mut x = 5').body[0]).toMatchObject({ type: 'decl', kind: 'mut' });
  });

  it('throws ParseError with position on malformed input', () => {
    expect(() => parse('let = 5')).toThrow(ParseError);
    expect(() => parse('draw line(')).toThrow(ParseError);
  });
});
