/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Prevent webpack from bundling native/WASM packages that must be loaded
    // by Node.js at runtime. heic-decode uses @napi-rs/wasm-runtime (WASM)
    // and sharp uses native binaries — both must be kept external.
    serverComponentsExternalPackages: ['sharp', 'heic-decode'],
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
