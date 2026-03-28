import path from 'node:path';

const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
  webpack(config) {
    config.resolve.alias['react-router-dom'] = path.resolve('./src/router/react-router-dom.tsx');
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendProxyTarget}/api/:path*`,
      },
      {
        source: '/sdk.js',
        destination: `${backendProxyTarget}/sdk.js`,
      },
      {
        source: '/widget-demo',
        destination: `${backendProxyTarget}/widget-demo`,
      },
      {
        source: '/basjoo-logo.png',
        destination: `${backendProxyTarget}/basjoo-logo.png`,
      },
      {
        source: '/health',
        destination: `${backendProxyTarget}/health`,
      }
    ];
  },
};

export default nextConfig;
