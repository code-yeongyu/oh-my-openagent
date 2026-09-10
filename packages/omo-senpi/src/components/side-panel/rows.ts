import type { OmoSidePanelSections } from "@oh-my-opencode/omo-config-core"

import type { PanelHostFacts } from "./data/facts"
import { buildAgentRows } from "./sections/agents"
import { buildContextRows } from "./sections/context"
import { buildFileRows, type PanelGitStatus } from "./sections/files"
import { buildLocationRows, type PanelLocation } from "./sections/location"
import { buildSessionRows } from "./sections/session"
import { buildToolRows } from "./sections/tools"
import type { PanelState } from "./store"
import type { PanelRow } from "./types"

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
  readonly home?: string
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
    input.sections.context ? [...buildContextRows(input.facts.usage, width)] : [],
    input.sections.agents ? [...buildAgentRows(input.state.children, input.now, width)] : [],
    input.sections.tools ? [...buildToolRows(input.state.tools, width, input.toolRows)] : [],
    input.sections.files ? [...buildFileRows(input.git, width, input.fileRows)] : [],
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
