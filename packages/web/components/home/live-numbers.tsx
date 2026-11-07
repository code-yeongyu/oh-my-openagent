"use client"

import type { JSX } from "react"

import { useLiveStats } from "@/components/landing/live-stats"
import type { FormattedStatsData } from "@/lib/stats"

export interface LiveNumberLabels {
  readonly label: string
  readonly stars: string
  readonly total: string
  readonly monthly: string
}

/** The server-rendered numbers, refreshed once from /api/stats (a fallback or zero answer keeps the cached value). */
export function LiveNumbers({
  stats,
  labels,
}: {
  readonly stats: FormattedStatsData
  readonly labels: LiveNumberLabels
}): JSX.Element {
  const live = useLiveStats(stats)
  const rows = [
    [live.stars, labels.stars],
    [live.totalDownloads, labels.total],
    [live.monthlyDownloads, labels.monthly],
  ] as const

  return (
    <ul className="stats rise" aria-label={labels.label}>
      {rows.map(([value, label]) => (
        <li key={label}>
          <strong>{value}</strong> <span>{label}</span>
        </li>
      ))}
    </ul>
  )
}
