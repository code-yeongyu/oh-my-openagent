import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"
import { resolveBuildId } from "./lib/build-id.mjs"

const nextConfig: NextConfig = {
  // The desktop download launch flag is a build input, inlined into every bundle (pages, the
  // prerendered landing page, the sitemap and the proxy), so one build env turns it all on or off.
  env: {
    OMO_WEB_DESKTOP_DOWNLOAD: process.env.OMO_WEB_DESKTOP_DOWNLOAD === "1" ? "1" : "",
    // The build id, inlined so the root layout can mark a deployment made by the pipeline (see live-asset-inventory).
    OMO_WEB_BUILD_ID: resolveBuildId(process.env) ?? "",
  },
  allowedDevOrigins: ["127.0.0.1", "::1"],
  expireTime: 3600,
  // One build id per commit, so /_next/static/<id>/ always names one set of bytes (lib/build-id.mjs). Next's
  // deploymentId is not set: with it, every build shares one constant build id.
  generateBuildId: () => resolveBuildId(process.env),
  // The root layouts live under app/[locale] and app/design (so <html lang> follows the route).
  // app/global-not-found.tsx only renders for a URL that matches no route, which [locale] currently prevents (#11528).
  experimental: {
    globalNotFound: true,
  },
  turbopack: {
    root: __dirname,
  },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
