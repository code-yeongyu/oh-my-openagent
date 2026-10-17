import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const nextConfig: NextConfig = {
  // The desktop download launch flag is a build input, inlined into every bundle (pages, the
  // prerendered landing page, the sitemap and the proxy), so one build env turns it all on or off.
  env: { OMO_WEB_DESKTOP_DOWNLOAD: process.env.OMO_WEB_DESKTOP_DOWNLOAD === "1" ? "1" : "" },
  allowedDevOrigins: ["127.0.0.1", "::1"],
  expireTime: 3600,
  deploymentId: process.env.GITHUB_SHA,
  turbopack: {
    root: __dirname,
  },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
