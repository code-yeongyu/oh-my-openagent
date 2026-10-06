import { ImageResponse } from "next/og"
import { decodeFont, robotoMonoRegularBase64, robotoMonoBoldBase64 } from "@/lib/og/fonts"
import { SocialImage } from "@/lib/og/social-image"
import { getOgDownloads } from "@/lib/og/downloads"
import type { OgCount } from "@/lib/og/live-count"
import { getOgStars } from "@/lib/og/stars"

export const alt =
  "OmO. Your tool for real work. But it's an agent. The OmO cat, live GitHub stars and npm downloads."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const dynamic = "force-dynamic"

const fonts = [
  {
    name: "Roboto Mono",
    data: decodeFont(robotoMonoRegularBase64),
    weight: 400,
    style: "normal",
  },
  {
    name: "Roboto Mono",
    data: decodeFont(robotoMonoBoldBase64),
    weight: 700,
    style: "normal",
  },
] satisfies NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]

// Downstream caches may keep the image only while every figure in it is still fresh;
// any degraded figure makes the response uncacheable so it recovers on the next request.
function cacheControl(figures: readonly OgCount[]): string {
  let expiresAt = Number.POSITIVE_INFINITY
  for (const figure of figures) {
    if (figure.source !== "live") return "no-store"
    expiresAt = Math.min(expiresAt, figure.expiresAt)
  }
  const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000))
  return `public, max-age=0, s-maxage=${seconds}, must-revalidate`
}

export default async function OpenGraphImage() {
  const [stars, downloads] = await Promise.all([getOgStars(), getOgDownloads()])
  return new ImageResponse(<SocialImage stars={stars.count} downloads={downloads.count} />, {
    ...size,
    fonts,
    headers: {
      "Cache-Control": cacheControl([stars, downloads]),
      "X-OG-Stars": stars.count === null ? "unavailable" : String(stars.count),
      "X-OG-Stars-Source": stars.source,
      "X-OG-Downloads": downloads.count === null ? "unavailable" : String(downloads.count),
      "X-OG-Downloads-Source": downloads.source,
    },
  })
}
