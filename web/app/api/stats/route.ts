import { NextResponse } from "next/server"
import { getStats, formatStats } from "@/lib/stats"

const FALLBACK = {
  stars: "37.3k",
  totalDownloads: "1M+",
  monthlyDownloads: "580k+",
  weeklyDownloads: "90k+",
}

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
    return NextResponse.json(FALLBACK, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    })
  }
}
