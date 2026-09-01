import { NextResponse } from "next/server"
import { getStats, formatStats, FALLBACK_FORMATTED_STATS } from "@/lib/stats"

export async function GET() {
  try {
    const stats = await getStats()
    const formatted = formatStats(stats)

    return NextResponse.json(
      { ...formatted, raw: stats },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    )
  } catch {
    return NextResponse.json(FALLBACK_FORMATTED_STATS, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    })
  }
}
