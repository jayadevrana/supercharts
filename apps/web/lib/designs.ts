/**
 * Design-pack registry — full look variants layered on top of a skin's colors:
 * typography (--font-sans), icon stroke weight, control density, and shape
 * language, all via the [data-design] CSS blocks in globals.css. Picking a
 * design also applies its paired skin so each option lands as one complete,
 * coherent look; the Theme grid can still recolor it afterwards.
 * No data-design attribute = Classic (the original look, untouched).
 */

export interface DesignPack {
  id: string;
  label: string;
  tagline: string;
  /** Skin (lib/skins.ts) applied together with the design. */
  skinId: string;
  /** Two-letter type specimen for the picker card. */
  specimen: string;
}

export const CLASSIC_DESIGN_ID = 'classic';
/** The shipped default look (owner goal: professional, high-contrast, 3D depth). */
export const DEFAULT_DESIGN_ID = 'vertex';

export const DESIGNS: DesignPack[] = [
  {
    id: 'vertex',
    label: 'Vertex',
    tagline: 'Flagship: high-contrast 3D depth',
    skinId: 'obsidian',
    specimen: 'Aa',
  },
  {
    id: CLASSIC_DESIGN_ID,
    label: 'Classic',
    tagline: 'The original SuperCharts look',
    skinId: 'dark',
    specimen: 'Aa',
  },
  {
    id: 'apex',
    label: 'Apex',
    tagline: 'TradingView-grade: Inter, compact, squared',
    skinId: 'graphite',
    specimen: 'Aa',
  },
  {
    id: 'ledger',
    label: 'Ledger',
    tagline: 'Institutional dense: condensed type, sharp',
    skinId: 'carbon',
    specimen: 'Aa',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    tagline: 'Quant console: monospace UI, blocky',
    skinId: 'phosphor',
    specimen: 'Aa',
  },
  {
    id: 'nova',
    label: 'Nova',
    tagline: 'Modern product feel: roomy, soft radii',
    skinId: 'midnight',
    specimen: 'Aa',
  },
  {
    id: 'swiss',
    label: 'Swiss',
    tagline: 'Print-clean light: Helvetica, hairlines',
    skinId: 'arctic',
    specimen: 'Aa',
  },
  {
    id: 'sovereign',
    label: 'Sovereign',
    tagline: 'Executive: generous, gold, bold icons',
    skinId: 'aurum',
    specimen: 'Aa',
  },
];

export function getDesign(id: string | null | undefined): DesignPack {
  return DESIGNS.find((d) => d.id === id) ?? DESIGNS.find((d) => d.id === CLASSIC_DESIGN_ID)!;
}

export function isDesignId(id: string | null | undefined): boolean {
  return DESIGNS.some((d) => d.id === id);
}
