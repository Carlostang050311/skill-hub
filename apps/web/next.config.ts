import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@skillhub/core", "@skillhub/eval"],
};

export default nextConfig;
