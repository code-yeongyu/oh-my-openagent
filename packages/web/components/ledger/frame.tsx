import type { JSX, ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface FrameProps {
  readonly children: ReactNode
  /** Let children span all three tracks (hero wash, CTA band). */
  readonly bleed?: boolean
  readonly className?: string
  readonly innerClassName?: string
  readonly as?: "div" | "section" | "header" | "footer"
  readonly id?: string
  readonly "aria-labelledby"?: string
}

/**
 * DESIGN.md §4 Frame (`grid-wrapper`): `1fr minmax(0, 90rem) 1fr`, content in the
 * center track, 1px `--line` side rules at ≥ lg. Gutters 16 → 20 → 32px.
 */
export function Frame({
  children,
  bleed = false,
  className,
  innerClassName,
  as: Tag = "div",
  id,
  "aria-labelledby": ariaLabelledBy,
}: FrameProps): JSX.Element {
  return (
    <Tag id={id} aria-labelledby={ariaLabelledBy} className={cn("frame", className)}>
      <div className={cn(bleed ? "frame-bleed" : "px-4 sm:px-5 lg:px-8", innerClassName)}>
        {children}
      </div>
    </Tag>
  )
}
