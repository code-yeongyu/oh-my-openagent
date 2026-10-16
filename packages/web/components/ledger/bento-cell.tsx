import type { JSX, ReactNode } from "react"

import { Chip } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type BentoSpan = 1 | 2

export interface BentoGridProps {
  readonly children: ReactNode
  readonly className?: string
  readonly "aria-labelledby"?: string
}

/**
 * DESIGN.md §5 agents grid: 1 column → 2 (md) → 4 (lg), `grid-flow-dense`,
 * 1px gaps over a `--line` background so the grid itself draws the rules.
 */
export function BentoGrid({
  children,
  className,
  "aria-labelledby": ariaLabelledBy,
}: BentoGridProps): JSX.Element {
  return (
    <ul
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "bg-line border-line grid grid-flow-dense grid-cols-1 gap-px border md:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </ul>
  )
}

export interface BentoCellProps {
  readonly name: ReactNode
  readonly role: ReactNode
  /** 20px SVG icon (Lucide / Phosphor). Turns `--accent` on hover. */
  readonly icon?: ReactNode
  /** Model chip label (Meta mono). */
  readonly chip?: ReactNode
  /** Column span from md upward. */
  readonly colSpan?: BentoSpan
  /** Row span from md upward. */
  readonly rowSpan?: BentoSpan
  /** Selected from the graph: `--accent-8` fill + inset selection ring. */
  readonly active?: boolean
  readonly id?: string
  readonly className?: string
  readonly children?: ReactNode
}

const COL_SPAN: Record<BentoSpan, string> = { 1: "", 2: "md:col-span-2" }
const ROW_SPAN: Record<BentoSpan, string> = { 1: "", 2: "md:row-span-2" }

/** DESIGN.md §5 BentoCell: `--ink-1` fill, hover `--ink-2` + accent icon, 0px radius. */
export function BentoCell({
  name,
  role,
  icon,
  chip,
  colSpan = 1,
  rowSpan = 1,
  active = false,
  id,
  className,
  children,
}: BentoCellProps): JSX.Element {
  return (
    <li
      id={id}
      data-active={active ? "true" : undefined}
      className={cn(
        "group bg-ink-1 hover:bg-ink-2 data-[active=true]:bg-accent-8 ease-standard relative flex min-h-44 flex-col gap-3 p-6 transition-colors duration-[var(--dur-micro)] focus-within:shadow-[inset_0_0_0_1px_var(--accent-32)] data-[active=true]:shadow-[inset_0_0_0_1px_var(--accent-32)]",
        COL_SPAN[colSpan],
        ROW_SPAN[rowSpan],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className="text-text-lo group-hover:text-accent group-data-[active=true]:text-accent ease-standard transition-colors duration-[var(--dur-micro)] [&_svg]:size-5"
          >
            {icon}
          </span>
        ) : null}
        {chip ? <Chip>{chip}</Chip> : null}
      </div>
      <div className="mt-auto">
        <h3 className="text-text-hi text-lg leading-[1.35] font-medium tracking-[-0.01em]">
          {name}
        </h3>
        <p className="text-text-mid mt-1 text-sm leading-[1.55]">{role}</p>
      </div>
      {children}
    </li>
  )
}
