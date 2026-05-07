/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // sharp is a native module — must not be webpack-bundled so Node.js can
    // load it with require() at runtime. heic-decode removed (not installed;
    // sharp handles HEIC natively via libvips).
    serverComponentsExternalPackages: ['sharp'],
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
