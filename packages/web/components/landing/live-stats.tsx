"use client"

import { useEffect, useState } from "react"

interface StatsData {
  stars: string
  totalDownloads: string
  monthlyDownloads: string
  weeklyDownloads: string
}

function readStringField(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined
  const value = Reflect.get(source, key)
  return typeof value === "string" ? value : undefined
}

function hasPositiveDisplayCount(value: string | undefined): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !/^0(?:\.0)?[kM]?\+?$/i.test(trimmed)
}

function pickLiveCount(value: string | undefined, cachedValue: string): string {
  return hasPositiveDisplayCount(value) ? value : cachedValue
}

export function useLiveStats(initial: StatsData): StatsData {
  const [stats, setStats] = useState<StatsData>(initial)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch("/api/stats")
        if (!res.ok || cancelled) return
        const data: unknown = await res.json()
        if (cancelled) return
        setStats({
          stars: pickLiveCount(readStringField(data, "stars"), initial.stars),
          totalDownloads: pickLiveCount(
            readStringField(data, "totalDownloads"),
            initial.totalDownloads,
          ),
          monthlyDownloads: pickLiveCount(
            readStringField(data, "monthlyDownloads"),
            initial.monthlyDownloads,
          ),
          weeklyDownloads: pickLiveCount(
            readStringField(data, "weeklyDownloads"),
            initial.weeklyDownloads,
          ),
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
