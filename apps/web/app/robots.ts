import type { MetadataRoute } from 'next';

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://supercharting.com').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private, auth-gated app surfaces — no value to crawlers, keep them out of the index.
      disallow: ['/terminal', '/account', '/verify', '/api/'],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
