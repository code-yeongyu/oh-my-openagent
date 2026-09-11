import type { MetadataRoute } from "next"

const BASE_URL = "https://omo.dev"

/**
 * Public, localized routes only. The primitive showcase `/design` (rendered only when
 * OMO_WEB_SHOWCASE=1, see app/design/page.tsx) is intentionally not listed here.
 */
const PUBLIC_ROUTES = ["", "/docs", "/manifesto"]

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = ["en", "ko", "ja", "zh"]

  return PUBLIC_ROUTES.flatMap((route) =>
    locales.map((locale) => ({
      url: `${BASE_URL}/${locale}${route}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1 : 0.8,
    })),
  )
}
