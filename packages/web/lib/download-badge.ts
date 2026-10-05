import { NextResponse } from "next/server"

function formatDownloads(num: number): string {
  if (num >= 1_000_000) {
    const formatted = (num / 1_000_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}M`
  }
  if (num >= 1_000) {
    const formatted = (num / 1_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}k`
  }
  return String(num)
}

// Shields.io endpoint badge schema: https://shields.io/badges/endpoint-badge
export function downloadBadgeResponse(label: string, message: string, live: boolean): NextResponse {
  return NextResponse.json(
    {
      schemaVersion: 1,
      label,
      message,
      color: "ff6b35",
      labelColor: "000000",
      style: "flat-square",
    },
    {
      headers: {
        "Cache-Control": live
          ? "public, s-maxage=3600, stale-while-revalidate=86400"
          : "public, s-maxage=300, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  )
}

export function liveDownloadBadge(label: string, value: number): NextResponse {
  return downloadBadgeResponse(label, formatDownloads(value), true)
}
