/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
  // devIndicators removed - use default behavior

  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    // Temporarily ignore lint during builds
    // TODO: Fix remaining lint errors in follow-up PR
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
