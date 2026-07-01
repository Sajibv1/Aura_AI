import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/chat": ["./node_modules/pdfjs-dist/legacy/build/**/*"],
  },
};

export default nextConfig;
