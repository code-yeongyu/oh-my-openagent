import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { ConclusionHistory } from "./transition-types"
import { checkGate } from "./gate-checker"
import type { PersistedSessionState } from "./persistence-types"
import type { EpistemicAnnotation } from "./types"

export function toHydratedConclusions(persisted: PersistedSessionState): Record<string, ConclusionHistory> {
  return Object.fromEntries(
    Object.entries(persisted.conclusions).map(([conclusion, history]) => [
      conclusion,
      {
        ...history,
        lastClassification: history.entries.at(-1)?.classification ?? history.currentState,
        lastSeenInvocation: history.lastSeenInvocation,
        exclusionTheoryHash: history.exclusionTheoryHash ?? undefined,
      },
    ]),
  )
}

export function assertEpistemicGate(annotations: EpistemicAnnotation[], gateMode?: EpistemicGateMode): void {
  const resolvedGateMode = gateMode ?? "annotation"
  if (resolvedGateMode === "annotation") return

  for (const annotation of annotations) {
    const gateResult = checkGate(annotation.state, resolvedGateMode, annotation.conclusion)
    if (!gateResult.allowed) throw new Error(`[epistemic gate] ${gateResult.reason}`)
  }
}
