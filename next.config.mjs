/** @type {import('next').NextConfig} */
const nextConfig = {
  // heic-decode / libheif-js embed WASM files that can't be webpack-bundled.
  // Mark them external so Next.js loads them from node_modules at runtime.
  serverExternalPackages: ['heic-decode', 'libheif-js'],
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
