/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@supercharts/chart-core', '@supercharts/types', '@supercharts/market-data'],
  experimental: {
    typedRoutes: false,
  },
  async rewrites() {
    const target = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;
