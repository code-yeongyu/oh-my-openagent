import type { MetadataRoute } from "next"

/**
 * `/design` is the primitive showcase (DESIGN.md §5/§13). It only renders when
 * OMO_WEB_SHOWCASE=1 and is never indexable.
 */
const SHOWCASE_ENABLED = process.env.OMO_WEB_SHOWCASE === "1"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: SHOWCASE_ENABLED ? ["/design"] : [],
    },
    sitemap: "https://omo.dev/sitemap.xml",
  }
}
