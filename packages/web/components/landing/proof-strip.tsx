"use client"

import type { JSX, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { Bot, Download, Star } from "lucide-react"

import { useLiveStats } from "@/components/landing/live-stats"
import { cn } from "@/lib/utils"

const COUNT_MS = 600

interface StatsSnapshot {
  readonly stars: string
  readonly totalDownloads: string
  readonly monthlyDownloads: string
  readonly weeklyDownloads: string
}

export interface ProofStripProps {
  readonly initialStats: StatsSnapshot
  readonly labels: {
    readonly githubStars: string
    readonly totalDownloads: string
    readonly monthlyDownloads: string
    readonly agents: string
  }
  readonly agentCount: string
  readonly className?: string
}

/** Once-on-enter gate (30% visible). */
function useEntered(): { ref: (node: HTMLElement | null) => void; entered: boolean } {
  const [entered, setEntered] = useState(false)
  const nodeRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const node = nodeRef.current
    if (!node || entered) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setEntered(true)
        observer.disconnect()
      },
      { threshold: 0.3 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [entered])

  return {
    ref: (node) => {
      nodeRef.current = node
    },
    entered,
  }
}

/**
 * Counts "68.8k" / "1M+" / "580k+" from 0 to the numeric part over 600ms (`--dur-count`),
 * once, keeping the suffix. Reduced motion or an unparsable value renders the target.
 */
function useCountUp(target: string, start: boolean): string {
  const [display, setDisplay] = useState(target)
  const finished = useRef(false)

  useEffect(() => {
    if (finished.current) {
      setDisplay(target)
      return
    }
    if (!start) return
    const match = /^(\d+(?:\.(\d+))?)(.*)$/.exec(target)
    const numeric = match?.[1]
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!numeric || reduced) {
      finished.current = true
      setDisplay(target)
      return
    }
    const end = Number.parseFloat(numeric)
    const decimals = match[2]?.length ?? 0
    const suffix = match[3] ?? ""
    let frame = 0
    const startedAt = performance.now()
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / COUNT_MS)
      const eased = 1 - (1 - progress) ** 4
      setDisplay(`${(end * eased).toFixed(decimals)}${suffix}`)
      if (progress < 1) {
        frame = requestAnimationFrame(step)
      } else {
        finished.current = true
        setDisplay(target)
      }
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, start])

  return display
}

interface ProofCellProps {
  readonly value: string
  readonly label: string
  readonly icon: ReactNode
  readonly start: boolean
}

function ProofCell({ value, label, icon, start }: ProofCellProps): JSX.Element {
  const shown = useCountUp(value, start)
  return (
    <li className="bg-ink-0 hover:bg-accent-4 ease-standard flex flex-col gap-3 p-6 transition-colors duration-[var(--dur-micro)]">
      <span className="type-numeral text-text-hi">{shown}</span>{" "}
      <span className="eyebrow inline-flex items-center gap-2">
        <span aria-hidden="true" className="text-text-lo [&_svg]:size-3.5">
          {icon}
        </span>
        {label}
      </span>
    </li>
  )
}

/**
 * DESIGN.md §5 ProofStrip: 4 cells (2 × 2 below lg) ruled by `--line`; Numeral + Eyebrow +
 * 14px icon per cell. Values are live from `/api/stats` and count up once on enter.
 */
export function ProofStrip({
  initialStats,
  labels,
  agentCount,
  className,
}: ProofStripProps): JSX.Element {
  const stats = useLiveStats(initialStats)
  const { ref, entered } = useEntered()

  return (
    <ul
      ref={ref}
      data-testid="proof-strip"
      className={cn("bg-line border-line grid grid-cols-2 gap-px border lg:grid-cols-4", className)}
    >
      <ProofCell value={stats.stars} label={labels.githubStars} icon={<Star />} start={entered} />
      <ProofCell
        value={stats.totalDownloads}
        label={labels.totalDownloads}
        icon={<Download />}
        start={entered}
      />
      <ProofCell
        value={stats.monthlyDownloads}
        label={labels.monthlyDownloads}
        icon={<Download />}
        start={entered}
      />
      <ProofCell value={agentCount} label={labels.agents} icon={<Bot />} start={entered} />
    </ul>
  )
}
