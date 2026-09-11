"use client"

import type { JSX, ReactNode } from "react"

import { useGraphFocus } from "@/components/landing/graph/use-graph-focus"
import { BentoCell, BentoGrid, type BentoSpan } from "@/components/ledger/bento-cell"

export interface AgentGridItem {
  /** Graph node id; `data-active` follows `useGraphFocus().focusedId`. */
  readonly id: string
  readonly name: string
  readonly role: string
  readonly model: string
  readonly icon: ReactNode
  readonly colSpan: BentoSpan
  readonly rowSpan: BentoSpan
  readonly description?: string
}

export interface AgentsGridProps {
  readonly items: readonly AgentGridItem[]
  readonly "aria-labelledby": string
}

/** Gapless bento of the agent roster; the focused graph node lights its cell. */
export function AgentsGrid({
  items,
  "aria-labelledby": ariaLabelledBy,
}: AgentsGridProps): JSX.Element {
  const { focusedId } = useGraphFocus()

  return (
    <BentoGrid aria-labelledby={ariaLabelledBy}>
      {items.map((item) => (
        <BentoCell
          key={item.id}
          id={`agent-${item.id}`}
          name={item.name}
          role={item.role}
          chip={item.model}
          icon={item.icon}
          colSpan={item.colSpan}
          rowSpan={item.rowSpan}
          active={focusedId === item.id}
        >
          {item.description ? (
            <p className="text-text-lo mt-2 text-sm leading-[1.55]">{item.description}</p>
          ) : null}
        </BentoCell>
      ))}
    </BentoGrid>
  )
}
