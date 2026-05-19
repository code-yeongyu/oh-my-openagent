import { NextResponse } from "next/server"
import { getStats } from "@/lib/stats"

/**
 * Shields.io endpoint badge for combined NPM downloads.
 * Usage: https://img.shields.io/endpoint?url=https://ohmyopenagent.com/api/npm-downloads
 *
 * Combines downloads from both oh-my-opencode and oh-my-openagent packages.
 */

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get("period") ?? "total"

  try {
    const stats = await getStats()

    let value: number
    let label: string

    switch (period) {
      case "monthly":
        value = stats.monthlyDownloads
        label = "npm downloads/month"
        break
      case "weekly":
        value = stats.weeklyDownloads
        label = "npm downloads/week"
        break
      case "total":
      default:
        value = stats.totalDownloads
        label = "npm downloads"
        break
    }

    // Shields.io endpoint badge schema
    // https://shields.io/badges/endpoint-badge
    const badge = {
      schemaVersion: 1,
      label,
      message: formatDownloads(value),
      color: "ff6b35",
      labelColor: "000000",
      style: "flat-square",
    }

    return NextResponse.json(badge, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch {
    // Fallback badge
    return NextResponse.json(
      {
        schemaVersion: 1,
        label: "npm downloads",
        message: "1M+",
        color: "ff6b35",
        labelColor: "000000",
        style: "flat-square",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
          "Access-Control-Allow-Origin": "*",
        },
      },
    )
  }
}
