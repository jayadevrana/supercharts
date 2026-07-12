import type { Metadata } from 'next';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { RECIPES, RECIPE_CATEGORIES } from '@/features/docs/cookbook';

export const metadata: Metadata = {
  title: 'Cookbook',
  description:
    'Copy-paste PulseScript recipes for real strategies — MA-cross filters, SuperTrend, Bollinger and Keltner breakouts, RSI/MACD/Stochastic momentum, volume-spike alerts, and higher-timeframe gates. Every recipe runs on live candles.',
};

function slug(id: string): string {
  return id;
}

export default function Cookbook() {
  const byCategory = RECIPE_CATEGORIES.map((cat) => ({
    cat,
    recipes: RECIPES.filter((r) => r.category === cat),
  })).filter((g) => g.recipes.length > 0);

  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Cookbook</h1>
      <p className="max-w-2xl">
        Complete, runnable recipes for common strategies. Each one is a real script — hit{' '}
        <strong>Run in terminal</strong> to load it into the editor over live candles, then backtest, optimize, or turn it into
        an alert. Every recipe on this page is executed through the interpreter in our test suite, so nothing here is broken or
        pseudo-code.
      </p>

      <nav aria-label="Categories" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {byCategory.map(({ cat }) => (
          <a key={cat} href={`#${cat.toLowerCase().replace(/\s+/g, '-')}`} className="text-accent hover:underline">
            {cat}
          </a>
        ))}
      </nav>

      {byCategory.map(({ cat, recipes }) => (
        <section key={cat} className="pt-4">
          <h2
            id={cat.toLowerCase().replace(/\s+/g, '-')}
            className="scroll-mt-20 text-xl font-semibold text-foreground"
          >
            {cat}
          </h2>
          {recipes.map((r) => (
            <div key={r.id} id={slug(r.id)} className="scroll-mt-20 pt-4">
              <h3 className="text-base font-semibold text-foreground">{r.title}</h3>
              <p className="mt-1">{r.blurb}</p>
              <PulseCodeBlock code={r.code} />
            </div>
          ))}
        </section>
      ))}

      <p className="pt-4 text-xs">
        Want the full function list? See the{' '}
        <a href="/docs/reference/ta" className="text-accent hover:underline">
          ta.* reference
        </a>{' '}
        — every study with a runnable example — or the{' '}
        <a href="/docs/language" className="text-accent hover:underline">
          language tour
        </a>
        .
      </p>
    </article>
  );
}
