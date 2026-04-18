/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  // Prevent shaka-player from being bundled server-side (it uses browser globals)
  serverExternalPackages: ['shaka-player'],
}
module.exports = nextConfig
