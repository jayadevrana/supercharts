import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN_ID, getSkin, isSkinId, SKINS } from '../apps/web/lib/skins';

const repo = join(__dirname, '..');

describe('skin registry', () => {
  it('has unique ids and includes the classic defaults', () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('dark');
    expect(ids).toContain('light');
    // The 6 professional options from the spec.
    for (const id of ['graphite', 'midnight', 'carbon', 'phosphor', 'arctic', 'aurum']) {
      expect(ids).toContain(id);
    }
  });

  it('every skin carries a complete chart palette and a valid family', () => {
    for (const skin of SKINS) {
      expect(['dark', 'light']).toContain(skin.family);
      const chart = skin.chart as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(chart)) {
        if (typeof value === 'string') {
          expect(value.length, `${skin.id}.${key} empty`).toBeGreaterThan(0);
        }
      }
      expect(skin.chart.heatmap.bid).toHaveLength(3);
      expect(skin.chart.heatmap.ask).toHaveLength(3);
      expect(skin.chart.heatmap.background).toHaveLength(3);
      for (const c of Object.values(skin.preview)) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('getSkin falls back to the default for unknown ids', () => {
    expect(getSkin('nope').id).toBe(DEFAULT_SKIN_ID);
    expect(getSkin(null).id).toBe(DEFAULT_SKIN_ID);
    expect(getSkin('graphite').id).toBe('graphite');
    expect(isSkinId('carbon')).toBe(true);
    expect(isSkinId('tv-dark')).toBe(false);
  });
});

describe('skin CSS drift guards', () => {
  const globals = readFileSync(join(repo, 'apps/web/app/globals.css'), 'utf8');
  const tailwind = readFileSync(join(repo, 'apps/web/tailwind.config.ts'), 'utf8');

  it('globals.css defines a data-theme block for every skin', () => {
    for (const skin of SKINS) {
      expect(globals, `missing [data-theme='${skin.id}'] block`).toContain(
        `[data-theme='${skin.id}']`,
      );
    }
  });

  it('non-default skins flatten panels and set radii', () => {
    for (const skin of SKINS.filter((s) => s.id !== 'dark' && s.id !== 'light')) {
      const block = globals.split(`[data-theme='${skin.id}']`)[1]?.split('}')[0] ?? '';
      expect(block, `${skin.id} missing --radius-lg`).toContain('--radius-lg');
      expect(block, `${skin.id} missing --panel-bg`).toContain('--panel-bg');
    }
  });

  it('tailwind radius + glass tokens are skin-controllable vars', () => {
    expect(tailwind).toContain("var(--radius-sm");
    expect(tailwind).toContain("var(--radius-lg");
    expect(tailwind).toContain('var(--panel-shadow');
  });
});
