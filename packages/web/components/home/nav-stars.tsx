"use client"

import type { JSX } from "react"

import { Icon } from "@/components/home/icons"
import { GITHUB_URL } from "@/components/home/links"
import { useLiveStats } from "@/components/landing/live-stats"

/** `label` is the translated template with a {count} placeholder. The nav's GitHub star count, refreshed from /api/stats like the live numbers on the home page. */
export function NavStars({
  stars,
  label,
}: {
  readonly stars: string
  readonly label: string
}): JSX.Element {
  const live = useLiveStats({
    stars,
    totalDownloads: "",
    monthlyDownloads: "",
    weeklyDownloads: "",
  })
  return (
    <a
      className="btn btn--ghost btn--sm nav__stars"
      href={GITHUB_URL}
      aria-label={label.replace("{count}", live.stars)}
    >
      <Icon name="github" className="btn__icon" />
      <span className="tabular">{live.stars}</span>
    </a>
  )
}
