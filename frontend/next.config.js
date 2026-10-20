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
  // Hide the floating "N" dev-mode badge (it overlapped the sidebar)
  devIndicators: false,
}
module.exports = nextConfig
