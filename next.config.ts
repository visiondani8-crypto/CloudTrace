import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content security policy. Next.js injects small inline bootstrap scripts, so
// 'unsafe-inline' is required for scripts without a per-request nonce pipeline.
// No third-party origins are allowed: fonts are self-hosted, external source
// links are plain anchors opened by explicit user action, and outbound calls
// (Anthropic, Microsoft Graph) happen only on the server.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Lets a dev server run beside a production build without overwriting it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Keep the Anthropic SDK and Prisma out of client bundles; they are server-only.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
