import { ImageResponse } from "next/og"
import { decodeFont, geistMediumBase64, geistMonoRegularBase64 } from "@/lib/og/fonts"
import { MinimalSocialImage, SocialImage } from "@/lib/og/social-image"
import {
  getStats,
  formatStats,
  FALLBACK_FORMATTED_STATS,
  type FormattedStatsData,
} from "@/lib/stats"

export const alt = "Oh My OpenAgent - the agent harness. Live GitHub stars and project one-liner."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const revalidate = 3600

const cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400"
const degradedCacheControl = "public, s-maxage=300, stale-while-revalidate=3600"

function brandFonts() {
  return [
    { name: "Geist", data: decodeFont(geistMediumBase64), weight: 500, style: "normal" } as const,
    {
      name: "Geist Mono",
      data: decodeFont(geistMonoRegularBase64),
      weight: 400,
      style: "normal",
    } as const,
  ]
}

async function renderPng(element: React.ReactElement, fonts?: ReturnType<typeof brandFonts>) {
  return await new ImageResponse(element, { ...size, fonts }).arrayBuffer()
}

async function loadStats(): Promise<FormattedStatsData> {
  try {
    return formatStats(await getStats())
  } catch (error) {
    console.warn("Unable to refresh social image stats; using fallback data", error)
    return FALLBACK_FORMATTED_STATS
  }
}

export default async function OpenGraphImage() {
  const stats = await loadStats()
  try {
    const png = await renderPng(<SocialImage stats={stats} />, brandFonts())
    return new Response(png, {
      headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
    })
  } catch (error) {
    console.warn("Social image render failed; serving the minimal image", error)
    const png = await renderPng(<MinimalSocialImage stats={stats} />)
    return new Response(png, {
      headers: { "Content-Type": contentType, "Cache-Control": degradedCacheControl },
    })
  }
}
