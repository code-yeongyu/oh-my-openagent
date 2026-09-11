import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Legacy shadcn Badge, re-tokened (DESIGN.md §2/§4). Prefer `Chip` in new code. */
const badgeVariants = cva(
  "inline-flex items-center rounded-[2px] border px-2.5 py-0.5 text-xs font-medium transition-colors duration-[var(--dur-micro)] ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-32",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-ink-0",
        secondary: "border-line bg-ink-2 text-text-hi",
        destructive: "border-transparent bg-status-err text-text-hi",
        outline: "border-line-strong text-text-mid",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

/**
 * DESIGN.md §5 Chip: mono Meta text, `--ink-2` fill, `--line` border, 2px radius, 24px tall.
 * `accent` fills `--accent-8` with `--accent` text and is reserved for live/selected state.
 */
const chipVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-[2px] border px-2 font-mono text-meta tracking-meta whitespace-nowrap transition-colors duration-[var(--dur-micro)] ease-standard",
  {
    variants: {
      variant: {
        default: "border-line bg-ink-2 text-text-mid",
        accent: "border-accent-32 bg-accent-8 text-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof chipVariants> {}

function Chip({ className, variant, ...props }: ChipProps) {
  return <span className={cn(chipVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants, Chip, chipVariants }
