/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  // Prevent these packages from being bundled server-side
  serverExternalPackages: ['shaka-player', 'youtubei.js'],
}
module.exports = nextConfig
