import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the production bundle lean; the app is a single page + 2 API routes.
  reactStrictMode: true,
  // Images are local (public/samples) or user uploads; no remote optimisation needed.
  images: { unoptimized: true },
};

export default nextConfig;
