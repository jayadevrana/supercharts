import type { MetadataRoute } from 'next';

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://supercharting.com').replace(/\/$/, '');

/** Public, indexable routes. Private app routes (/terminal, /account, /verify) are excluded. */
const PATHS: Array<{ path: string; priority: number }> = [
  { path: '/', priority: 1 },
  { path: '/pricing', priority: 0.8 },
  { path: '/docs', priority: 0.9 },
  { path: '/docs/getting-started', priority: 0.7 },
  { path: '/docs/language', priority: 0.7 },
  { path: '/docs/cookbook', priority: 0.8 },
  { path: '/docs/screener', priority: 0.8 },
  { path: '/docs/backtesting', priority: 0.7 },
  { path: '/docs/automation', priority: 0.8 },
  { path: '/docs/from-pine', priority: 0.8 },
  { path: '/docs/reference/ta', priority: 0.6 },
  { path: '/docs/reference/math', priority: 0.6 },
  { path: '/docs/reference/inputs', priority: 0.6 },
  { path: '/docs/reference/outputs', priority: 0.6 },
  { path: '/login', priority: 0.3 },
  { path: '/signup', priority: 0.3 },
  { path: '/legal/terms', priority: 0.2 },
  { path: '/legal/privacy', priority: 0.2 },
  { path: '/legal/disclaimer', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PATHS.map(({ path, priority }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency: path.startsWith('/docs') ? 'weekly' : 'monthly',
    priority,
  }));
}
