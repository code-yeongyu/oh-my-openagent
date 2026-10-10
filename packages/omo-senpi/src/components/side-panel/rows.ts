import type { OmoSidePanelSections } from "@oh-my-opencode/omo-config-core"

import type { PanelHostFacts } from "./data/facts"
import { buildAgentRows } from "./sections/agents"
import { buildContextRows } from "./sections/context"
import { buildFileRows, type PanelGitStatus } from "./sections/files"
import { buildGoalRows } from "./sections/goal"
import { buildLocationRows, type PanelLocation } from "./sections/location"
import { buildMemoryRows } from "./sections/memory"
import { buildSessionRows } from "./sections/session"
import { buildToolRows } from "./sections/tools"
import { buildUsageRows } from "./sections/usage"
import type { PanelState } from "./store"
import type { PanelGoal, PanelMemory, PanelRow } from "./types"
import type { PanelUsageSnapshot } from "./usage/types"

export interface PanelRowsInput {
  readonly sections: OmoSidePanelSections
  readonly facts: PanelHostFacts
  readonly state: PanelState
  readonly location: PanelLocation
  readonly startedAt?: number
  readonly now: number
  /** How many tool rows the column shows before it starts counting the rest. */
  readonly toolRows: number
  /** How many file rows the column shows before it starts counting the rest. */
  readonly fileRows: number
  readonly git?: PanelGitStatus
  /** The session's registered goal; absent when none is registered or the host publishes none. */
  readonly goal?: PanelGoal
  readonly home?: string
  /** Subscription usage, absent until the poller has something - or when the section is off. */
  readonly usage?: PanelUsageSnapshot
  /** Memory identity and backlog; absent when memory is off or the identity would not resolve. */
  readonly memory?: PanelMemory
}

/**
 * Assemble the column, top to bottom, skipping whatever has nothing to say. A section that
 * returns no rows contributes no heading and no separator either, so an idle session shows a
 * short column instead of a wall of empty labels.
 */
export function buildPanelRows(input: PanelRowsInput, width: number): readonly PanelRow[] {
  if (width <= 0) return []
  const blocks: readonly PanelRow[][] = [
    input.sections.session
      ? [
          ...buildSessionRows(
            {
              ...(input.facts.model === undefined ? {} : { model: input.facts.model }),
              ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
              now: input.now,
              ...(input.facts.totals === undefined ? {} : { totals: input.facts.totals }),
              childSpend: input.state.childSpend,
            },
            width,
          ),
        ]
      : [],
    input.sections.goal && input.goal !== undefined ? [...buildGoalRows(input.goal, width)] : [],
    input.sections.context ? [...buildContextRows(input.facts.usage, width)] : [],
    input.sections.usage && input.usage !== undefined ? [...buildUsageRows(input.usage, input.now, width)] : [],
    input.sections.agents ? [...buildAgentRows(input.state.children, input.now, width)] : [],
    input.sections.tools ? [...buildToolRows(input.state.tools, width, input.toolRows)] : [],
    input.sections.files ? [...buildFileRows(input.git, width, input.fileRows)] : [],
    input.sections.memory && input.memory !== undefined ? [...buildMemoryRows(input.memory, input.now, width)] : [],
    // The location line closes the column: it answers "where am I" last, next to the editor.
    [...buildLocationRows(input.location, width, input.home)],
  ]
  const rows: PanelRow[] = []
  for (const block of blocks) {
    if (block.length === 0) continue
    if (rows.length > 0) rows.push({ text: "" })
    rows.push(...block)
  }
  return rows
}
