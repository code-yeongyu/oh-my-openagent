import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "::1"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    optimizeCss: true,
  },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
