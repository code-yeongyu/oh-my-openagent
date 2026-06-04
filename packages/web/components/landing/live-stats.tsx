"use client"

import { useEffect, useState } from "react"

interface StatsData {
  stars: string
  totalDownloads: string
  monthlyDownloads: string
  weeklyDownloads: string
}

export function useLiveStats(initial: StatsData): StatsData {
  const [stats, setStats] = useState<StatsData>(initial)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch("/api/stats")
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        setStats({
          stars: data.stars ?? initial.stars,
          totalDownloads: data.totalDownloads ?? initial.totalDownloads,
          monthlyDownloads: data.monthlyDownloads ?? initial.monthlyDownloads,
          weeklyDownloads: data.weeklyDownloads ?? initial.weeklyDownloads,
        })
      } catch {
        // keep SSG values on error
      }
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [initial.stars, initial.totalDownloads, initial.monthlyDownloads, initial.weeklyDownloads])

  return stats
}
