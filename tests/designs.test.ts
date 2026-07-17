import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_DESIGN_ID,
  DEFAULT_DESIGN_ID,
  DESIGNS,
  getDesign,
  isDesignId,
} from '../apps/web/lib/designs';
import { isSkinId } from '../apps/web/lib/skins';

const repo = join(__dirname, '..');

describe('design-pack registry', () => {
  it('has unique ids, includes classic, and every paired skin exists', () => {
    const ids = DESIGNS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(CLASSIC_DESIGN_ID);
    for (const id of ['vertex', 'apex', 'ledger', 'matrix', 'nova', 'swiss', 'sovereign']) {
      expect(ids).toContain(id);
    }
    for (const d of DESIGNS) {
      expect(isSkinId(d.skinId), `${d.id} pairs unknown skin ${d.skinId}`).toBe(true);
    }
  });

  it('the shipped default is the Vertex/Obsidian flagship', () => {
    expect(DEFAULT_DESIGN_ID).toBe('vertex');
    expect(isDesignId(DEFAULT_DESIGN_ID)).toBe(true);
    expect(getDesign(DEFAULT_DESIGN_ID).skinId).toBe('obsidian');
  });

  it('getDesign falls back to classic for unknown ids', () => {
    expect(getDesign('nope').id).toBe(CLASSIC_DESIGN_ID);
    expect(getDesign(null).id).toBe(CLASSIC_DESIGN_ID);
    expect(getDesign('ledger').id).toBe('ledger');
    expect(isDesignId('matrix')).toBe(true);
    expect(isDesignId('bloomberg')).toBe(false);
  });
});

describe('design CSS drift guards', () => {
  const globals = readFileSync(join(repo, 'apps/web/app/globals.css'), 'utf8');
  const layout = readFileSync(join(repo, 'apps/web/app/layout.tsx'), 'utf8');
  const button = readFileSync(join(repo, 'apps/web/components/ui/button.tsx'), 'utf8');

  it('globals.css defines a data-design block with full tokens for every non-classic design', () => {
    for (const d of DESIGNS.filter((x) => x.id !== CLASSIC_DESIGN_ID)) {
      const marker = `[data-design='${d.id}']`;
      expect(globals, `missing ${marker} block`).toContain(marker);
      const block = globals.split(marker)[1]?.split('}')[0] ?? '';
      for (const token of ['--font-sans', '--icon-stroke', '--control-h-sm', '--radius-lg']) {
        expect(block, `${d.id} missing ${token}`).toContain(token);
      }
    }
  });

  it('fonts are loaded and icon stroke follows the design token', () => {
    expect(layout).toContain('--font-inter');
    expect(layout).toContain('--font-condensed');
    expect(layout).toContain('--font-mono-ui');
    expect(globals).toContain('stroke-width: var(--icon-stroke, 2)');
  });

  it('control primitives consume the density tokens', () => {
    expect(button).toContain('--control-h-sm');
    expect(button).toContain('--control-fs-md');
  });
});
