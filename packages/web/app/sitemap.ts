import type { MetadataRoute } from "next"

const BASE_URL = "https://ohmyopenagent.com"

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/docs", "/manifesto"]
  const locales = ["en", "ko", "ja", "zh"]

  return routes.flatMap((route) =>
    locales.map((locale) => ({
      url: `${BASE_URL}/${locale}${route}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1 : 0.8,
    })),
  )
}
