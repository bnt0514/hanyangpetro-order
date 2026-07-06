import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['order.hanyangpetro.com'],
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
