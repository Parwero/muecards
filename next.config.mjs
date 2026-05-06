/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // heic-decode / libheif-js embed WASM — must not be webpack-bundled.
    serverComponentsExternalPackages: ['heic-decode', 'libheif-js'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
};

export default nextConfig;
