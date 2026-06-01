import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // pdfjs-dist is parsed server-side (lib/cattle-market-service.ts) to read the
  // public USDA AMS report 1778 PDF. Keep it external so Next doesn't try to
  // bundle its worker/eval paths into the server build.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
