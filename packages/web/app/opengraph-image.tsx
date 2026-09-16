import { ImageResponse } from "next/og"
import { decodeFont, robotoMonoRegularBase64, robotoMonoBoldBase64 } from "@/lib/og/fonts"
import { SocialImage } from "@/lib/og/social-image"
import { getOgStars } from "@/lib/og/stars"

export const alt =
  "OmO. Your tool for real work. But it's an agent. The OmO cat and live GitHub stars."
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

export default async function OpenGraphImage() {
  const stars = await getOgStars()
  return new ImageResponse(<SocialImage count={stars.count} />, {
    ...size,
    fonts,
    headers: {
      "Cache-Control":
        stars.source === "live"
          ? `public, max-age=0, s-maxage=${Math.max(0, Math.floor((stars.expiresAt - Date.now()) / 1_000))}, must-revalidate`
          : "no-store",
      "X-OG-Stars": stars.count === null ? "unavailable" : String(stars.count),
      "X-OG-Stars-Source": stars.source,
    },
  })
}
