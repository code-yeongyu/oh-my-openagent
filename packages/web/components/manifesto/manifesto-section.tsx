import type { JSX, ReactNode } from "react"

import { cn } from "@/lib/utils"

/** DESIGN.md §4 Manifesto: 68ch content limiter for prose. */
export const PROSE_LIMIT = "max-w-[68ch]"

/** §3 Title scale (section headlines, manifesto H2). */
export const TITLE_CLASS =
  "text-text-hi text-[clamp(2rem,1.3rem+2.4vw,3.25rem)] leading-[1.04] font-medium tracking-[-0.025em] text-balance"

/** §3 Heading scale (1.5rem / 1.2 / -0.015em). */
export const HEADING_CLASS = "text-text-hi text-2xl leading-[1.2] font-medium tracking-[-0.015em]"

/** §3 Lead (1.125rem -> 1.25rem at md, lh 1.6). */
export const LEAD_CLASS = "text-text-mid text-lg leading-[1.6] md:text-xl"

export interface ManifestoSectionProps {
  readonly children: ReactNode
  readonly "data-section": string
  /** Title element id for `aria-labelledby`. */
  readonly labelledBy?: string
  readonly className?: string
}

/**
 * A manifesto chapter: ruled from the previous one by a `--line` hairline (never a
 * background swap), `py-16 lg:py-24` rhythm, no card chrome.
 */
export function ManifestoSection({
  children,
  labelledBy,
  className,
  ...props
}: ManifestoSectionProps): JSX.Element {
  return (
    <section
      data-section={props["data-section"]}
      aria-labelledby={labelledBy}
      className={cn("hairline-x py-16 lg:py-24", className)}
    >
      {children}
    </section>
  )
}

export interface RuledListProps {
  readonly items: readonly { readonly key: string; readonly label: ReactNode }[]
  readonly icon?: ReactNode
  readonly className?: string
}

/** Hairline-ruled list for short principle lists (no bullets, no cards). */
export function RuledList({ items, icon, className }: RuledListProps): JSX.Element {
  return (
    <ul className={cn("border-line divide-line divide-y border-y", className)}>
      {items.map((item) => (
        <li key={item.key} className="text-text-mid flex items-start gap-3 py-3 leading-[1.6]">
          {icon ? (
            <span aria-hidden="true" className="text-text-lo mt-1.5 shrink-0">
              {icon}
            </span>
          ) : null}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
