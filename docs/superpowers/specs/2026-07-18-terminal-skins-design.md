# Terminal skins — 6 professional-grade UI options (2026-07-18)

## Goal

The owner wants the terminal to read as a professional-grade product (TradingView-class),
not "vibe coded". Deliver **6 complete skins** previewable live on localhost via an in-app
picker; the owner chooses one, it becomes the default, then deploy. Current dark/light stay
untouched as the default until the choice is made.

## Why full skins (approved scope)

The "vibe coded" feel comes from glassy gradient panels, large corner radii (6–16px), and
soft shadows — not just colors. Each skin therefore controls:

1. **App chrome CSS vars** — bg / fg / muted / surface(±raised/sunken) / border / ring /
   accent / bull / bear / warn (existing `data-theme` HSL-triple system in `globals.css`).
2. **Chart canvas palette** — a full `ChartTheme` (candles, wicks, grid, crosshair, volume,
   heatmap, bubbles, POC) per skin in `packages/chart-core/src/theme.ts`.
3. **Corner radius** — new `--radius-sm/base/md/lg/xl` vars; `tailwind.config.ts` radius
   tokens become `var(--radius-*, <current fallback>)` so flat skins get 2–6px corners while
   the default look is pixel-identical (fallbacks = today's values).
4. **Panel flatness** — `.glass-panel` reads `--panel-bg / --panel-shadow / --panel-blur /
   --panel-radius` vars (fallbacks = today's glass). Flat skins set solid surfaces, hairline
   borders, no blur. The Tailwind `shadow-glass` token becomes var-driven the same way.

## The 6 skins

| id | name | family | personality | key colors |
|---|---|---|---|---|
| `graphite` | Graphite | dark | TradingView-grade reference: flat, dense, squared | `#131722` bg · `#2962FF` accent · `#089981`/`#F23645` candles |
| `midnight` | Midnight | dark | institutional trading-desk navy | `#0B1220` bg · `#38BDF8` cyan · `#10B981`/`#F43F5E` |
| `carbon` | Carbon | dark | Bloomberg-style terminal black, amber | `#000` bg · `#F59E0B` amber · `#0ECB81`/`#F6465D` |
| `phosphor` | Phosphor | dark | quant/hacker green-on-black | `#0A0F0A` bg · `#22C55E` lime · green-tinted text/grid |
| `arctic` | Arctic | light | professional light (TV light style) | white bg · `#2962FF` accent · classic candles |
| `aurum` | Aurum | dark | premium dark + gold | warm charcoal · `#EAB308` gold · gold POC |

`dark` and `light` remain as "SuperCharts Dark/Light" — the current defaults.

## Architecture (all additive)

- `packages/chart-core/src/theme.ts` — +6 exported `ChartTheme` consts (spread from
  DARK/LIGHT with overrides). Already re-exported via `index.ts`.
- `apps/web/app/globals.css` — +6 `[data-theme='<id>']` var blocks (chrome + radius +
  panel vars). `.glass-panel` var-ified with today's values as fallbacks.
- `apps/web/tailwind.config.ts` — radius + `shadow-glass` tokens → vars w/ fallbacks.
- `apps/web/lib/skins.ts` — **new registry**: `{ id, label, tagline, family, chart,
  preview: { bg, accent, bull, bear } }` for all 8 ids (6 new + dark/light). Single source
  the provider, chart pane, and picker consume.
- `apps/web/components/theme-provider.tsx` — `Theme` widens to the registry ids; stored
  value validated against the registry (unknown → 'dark'). Same `sc.theme` localStorage key
  + `data-theme` attr — existing users see zero change.
- `apps/web/components/theme-toggle.tsx` — sun/moon icon keyed off skin **family**; toggle
  jumps to the opposite family's base theme (documented simplification).
- `apps/web/features/terminal/chart-pane.tsx` — `resolvedTheme` = registry lookup
  (`skin.chart`), replacing the dark/light ternary.
- `apps/web/features/terminal/workspace-settings-popover.tsx` — new **Theme** section on
  top: 2-col grid of skin cards (name + bg/accent/bull/bear swatch strip + active ring),
  applies instantly via `useTheme().setTheme`.

## Testing

`tests/skins.test.ts` (pure, relative-path imports per repo rule):
- registry ids unique; every skin's `chart` palette has every `ChartTheme` color field
  non-empty; families valid.
- **Drift guard:** `globals.css` (read as text) contains a `[data-theme='<id>']` block for
  every non-default skin id; `tailwind.config.ts` radius tokens reference `--radius-*`.

Browser verification: screenshot `/terminal` under each of the 6 skins at desktop width,
0 console errors, candles + panels render. Owner picks from the screenshots and/or flips
live on localhost via the Settings cog.

## Rollout

1. Land behind the picker — default stays `dark` (zero visual change for anyone).
2. Owner picks on localhost → chosen id becomes the provider default (and
   `:root:not([data-theme])` block if non-dark) → deploy web-only (no API restart).
3. Keep-or-hide the picker for end users = owner's call at pick time.

## Out of scope

Layout restructure (top bar / rails / spacing system), typography scale changes, per-user
server-persisted theme (localStorage only, as today). Live alert engine untouched.
