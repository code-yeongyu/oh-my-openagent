"use client"

import type { ReactNode } from "react"
import { Star, Bot, Download, GitBranch } from "lucide-react"
import { useLiveStats } from "./live-stats"

interface HeroStatsProps {
  initialStats: {
    stars: string
    totalDownloads: string
    monthlyDownloads: string
    weeklyDownloads: string
  }
  labels: {
    githubStars: string
    specializedAgents: string
    totalDownloads: string
    monthlyDownloads: string
    lifecycleHooks: string
  }
}

export function HeroStats({ initialStats, labels }: HeroStatsProps): ReactNode {
  const stats = useLiveStats(initialStats)

  return (
    <div className="flex flex-wrap justify-center gap-4 text-sm text-zinc-300 md:gap-8 md:text-base">
      <div className="flex items-center gap-2">
        <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
        <span>{labels.githubStars.replace("{count}", stats.stars)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-cyan-400" />
        <span>{labels.specializedAgents}</span>
      </div>
      <div className="flex items-center gap-2">
        <Download className="h-5 w-5 text-green-400" />
        <span>{labels.totalDownloads.replace("{count}", stats.totalDownloads)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Download className="h-5 w-5 text-emerald-400" />
        <span>{labels.monthlyDownloads.replace("{count}", stats.monthlyDownloads)}</span>
      </div>
      <div className="flex items-center gap-2">
        <GitBranch className="h-5 w-5 text-purple-400" />
        <span>{labels.lifecycleHooks}</span>
      </div>
    </div>
  )
}
