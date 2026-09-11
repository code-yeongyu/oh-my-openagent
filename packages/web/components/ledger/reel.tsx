"use client"

import type { JSX, KeyboardEvent, ReactNode } from "react"
import { useRef } from "react"

import { cn } from "@/lib/utils"

export interface ReelProps {
  readonly children: ReactNode
  /** Announced as the scroll region's name. */
  readonly label: string
  readonly className?: string
  readonly "aria-labelledby"?: string
}

/**
 * DESIGN.md §5 Reel: `grid-auto-flow: column; grid-auto-columns: minmax(280px, 34%)`,
 * the container owns the scroll (`scroll-snap-type: x mandatory`, 32px edge masks).
 * Arrow keys scroll by one cell; the region is focusable and labelled.
 */
export function Reel({
  children,
  label,
  className,
  "aria-labelledby": ariaLabelledBy,
}: ReelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  function scrollByCell(direction: -1 | 1): void {
    const reel = ref.current
    if (!reel) return
    const first = reel.firstElementChild
    const cell = first instanceof HTMLElement ? first.offsetWidth : reel.clientWidth
    const gap = Number.parseFloat(getComputedStyle(reel).columnGap) || 0
    reel.scrollBy({ left: direction * (cell + gap), behavior: "smooth" })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowRight") {
      event.preventDefault()
      scrollByCell(1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      scrollByCell(-1)
    }
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={ariaLabelledBy ? undefined : label}
      aria-labelledby={ariaLabelledBy}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "reel focus-visible:outline-accent-32 gap-px px-8 py-px focus-visible:outline-2 focus-visible:-outline-offset-2",
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface ReelCellProps {
  readonly children: ReactNode
  readonly className?: string
}

/** A snap-aligned, focusable `--ink-1` cell inside a Reel. */
export function ReelCell({ children, className }: ReelCellProps): JSX.Element {
  return (
    <article
      tabIndex={0}
      className={cn(
        "border-line bg-ink-1 hover:bg-ink-2 focus-visible:outline-accent-32 ease-standard flex min-h-56 snap-start flex-col border p-6 transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2",
        className,
      )}
    >
      {children}
    </article>
  )
}
