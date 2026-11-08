import type { RecallNudge } from "@oh-my-opencode/memory-core"

import { createKibitzerNudgeTool, KIBITZER_NUDGE_TOOL_NAME, KibitzerNudgeParams } from "../nudge-tool"
import type { WakeToolBudget } from "./budget"
import { budgeted, type KibitzerSidecarTool } from "./result"

export { KIBITZER_NUDGE_TOOL_NAME }

export interface KibitzerSidecarNudgeInput {
  /** Paths the parent offered to this sidecar lifetime (grows with every wake). */
  readonly offered: ReadonlySet<string>
  /** Corpus-verified paths the sidecar found through the memory tool's search operation. */
  readonly searched: ReadonlySet<string>
  /** Paths already surfaced in this main session; they never repeat. */
  readonly surfaced: ReadonlySet<string>
  /** memory.recall.max_items, applied to the CURRENT wake's accepted list. */
  readonly maxItems: number
  /** The current wake's accepted list; the lifecycle swaps it per wake. */
  readonly accepted: () => RecallNudge[]
  readonly budget: () => WakeToolBudget
}

/** `has` consults every source, so a path searched after creation is accepted without rebuilding. */
class UnionPathSet extends Set<string> {
  constructor(private readonly sources: readonly ReadonlySet<string>[]) {
    super()
  }

  override has(path: string): boolean {
    return this.sources.some((source) => source.has(path))
  }
}

/**
 * The sidecar's only output channel: the existing nudge closure (hint rules, secret check,
 * surfaced/system rejection, maxItems termination) re-bound at call time to the lifetime allowed set
 * `offered ∪ searched` and to the current wake's accepted list, and charged to the wake budget.
 */
export function createKibitzerSidecarNudgeTool(input: KibitzerSidecarNudgeInput): KibitzerSidecarTool<typeof KibitzerNudgeParams> {
  const candidates = new UnionPathSet([input.offered, input.searched])
  // The metadata (name, label, description, parameters) comes from the existing tool; only the
  // execute closure is replaced so the per-wake accepted list and budget are read at call time.
  const template = createKibitzerNudgeTool({ candidates, surfaced: input.surfaced, maxItems: input.maxItems, accepted: [] })
  return {
    ...template,
    execute: budgeted(input.budget, async (params) =>
      createKibitzerNudgeTool({
        candidates,
        surfaced: input.surfaced,
        maxItems: input.maxItems,
        accepted: input.accepted(),
      }).execute("", params)),
  }
}
