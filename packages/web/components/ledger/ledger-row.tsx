import type { JSX, ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface LedgerRowProps {
  /** Index cell, Numeral style in `--text-faint` ("01", "A", "v2"). */
  readonly index: ReactNode
  /** Heading level for the explanation title. */
  readonly title: ReactNode
  readonly titleAs?: "h2" | "h3" | "h4"
  /** Explanation column (Body / sm). */
  readonly children?: ReactNode
  /** Evidence column; stacks under the explanation below lg. */
  readonly evidence?: ReactNode
  /** Linked from the graph: 2px `--accent` left rule. */
  readonly active?: boolean
  readonly id?: string
  readonly className?: string
}

/**
 * DESIGN.md §5 LedgerRow: `[minmax(0,130px)] 1fr 1fr` at ≥ lg (index / explanation /
 * evidence), `[54px] 1fr` below. 24px vertical padding, hairline between rows,
 * `--accent-4` fill on hover, index turns `--accent` on focus-within.
 */
export function LedgerRow({
  index,
  title,
  titleAs: TitleTag = "h3",
  children,
  evidence,
  active = false,
  id,
  className,
}: LedgerRowProps): JSX.Element {
  return (
    <div
      id={id}
      data-active={active ? "true" : undefined}
      className={cn(
        "group border-line ease-standard relative grid grid-cols-[54px_1fr] gap-x-4 border-b py-6 transition-colors duration-[var(--dur-micro)] first:border-t",
        "hover:bg-accent-4 lg:grid-cols-[minmax(0,130px)_1fr_1fr] lg:gap-x-6",
        "data-[active=true]:before:bg-accent data-[active=true]:before:absolute data-[active=true]:before:inset-y-0 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:content-['']",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="text-text-faint ease-standard group-focus-within:text-accent group-data-[active=true]:text-accent font-medium tracking-[-0.03em] tabular-nums transition-colors duration-[var(--dur-micro)] lg:text-[clamp(2rem,1.4rem+2vw,2.75rem)] lg:leading-none"
      >
        {index}
      </div>
      <div className="min-w-0">
        <TitleTag className="text-text-hi text-2xl leading-[1.2] font-medium tracking-[-0.015em]">
          {title}
        </TitleTag>
        {children ? (
          <div className="text-text-mid mt-2 text-sm leading-[1.55]">{children}</div>
        ) : null}
      </div>
      {evidence ? (
        <div className="col-start-2 mt-4 min-w-0 lg:col-start-3 lg:mt-0">{evidence}</div>
      ) : null}
    </div>
  )
}
