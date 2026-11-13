import type { JSX, ReactNode } from "react"

import { cn } from "@/lib/utils"

export type EyebrowDot = "ok" | "busy" | "err" | "accent"

export interface EyebrowProps {
  readonly children: ReactNode
  /** Leading 24px `--line-strong` rule, like a ledger tab. */
  readonly rule?: boolean
  /** Trailing 8px status dot; pulses (2200ms) unless reduced motion. */
  readonly dot?: EyebrowDot
  readonly as?: "span" | "p" | "h2" | "h3"
  readonly className?: string
  readonly id?: string
}

const DOT_CLASS: Record<EyebrowDot, string> = {
  ok: "bg-status-ok",
  busy: "bg-status-busy",
  err: "bg-status-err",
  accent: "bg-accent",
}

/** DESIGN.md §5 Eyebrow: mono 11px uppercase 0.2em `--text-lo`. */
export function Eyebrow({
  children,
  rule = false,
  dot,
  as: Tag = "span",
  className,
  id,
}: EyebrowProps): JSX.Element {
  return (
    <Tag id={id} className={cn("eyebrow inline-flex items-center gap-2", className)}>
      {rule ? <span aria-hidden="true" className="bg-line-strong h-px w-6 shrink-0" /> : null}
      <span>{children}</span>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("pulse-dot size-2 shrink-0 rounded-full", DOT_CLASS[dot])}
        />
      ) : null}
    </Tag>
  )
}
