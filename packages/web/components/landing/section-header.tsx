import type { JSX, ReactNode } from "react"

import { Eyebrow, type EyebrowDot } from "@/components/ledger/eyebrow"
import { cn } from "@/lib/utils"

export interface SectionHeaderProps {
  /** id of the H2 (the section's `aria-labelledby`). */
  readonly id: string
  /** Content label with meaning ("PRIMARY ORCHESTRATOR"), never a chapter numeral. */
  readonly eyebrow: ReactNode
  readonly dot?: EyebrowDot
  readonly title: ReactNode
  readonly intro?: ReactNode
  readonly className?: string
}

/** Eyebrow → Title → Lead intro, left-aligned, max 42rem. */
export function SectionHeader({
  id,
  eyebrow,
  dot,
  title,
  intro,
  className,
}: SectionHeaderProps): JSX.Element {
  return (
    <header className={cn("max-w-3xl", className)}>
      <Eyebrow rule dot={dot} className="[&_.pulse-dot]:animate-none">
        {eyebrow}
      </Eyebrow>
      <h2 id={id} className="type-feature text-text-hi mt-4">
        {title}
      </h2>
      {intro ? (
        <p className="text-text-mid prose-cjk mt-6 max-w-[60ch] text-lg leading-[1.7]">{intro}</p>
      ) : null}
    </header>
  )
}
