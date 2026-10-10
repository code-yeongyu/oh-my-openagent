import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "::1"],
  expireTime: 3600,
  deploymentId: process.env.GITHUB_SHA,
  turbopack: {
    root: __dirname,
  },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
