// The candidates one Kibitzer start walks, in order, inside its own recall category (#10536).
//
// A start the post-start pin check refuses (`model_unavailable`: the engine opened another model
// than the pinned one) is not the user's to fix while the category still has another connected
// candidate, so the starter moves to the next one in the same call and remembers the refused model
// for the sidecar's life; later wakes then begin on the candidate that answered. The ladder is the
// resolution's own chain and never reaches beyond the category (#9111 / #9114). When every
// candidate has been refused, the next start walks the whole chain again so the failure is reported
// through the gate notice instead of being hidden.

import { childModelChainSpec, type ChildModelChainSpec } from "../memory-child-model-chain"
import type { ReflectionModelCandidate, ReflectionThinkingLevel } from "../worker/resolve-model"

export interface KibitzerStartCandidate {
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
  readonly chain: ChildModelChainSpec
}

export interface KibitzerStartResolution {
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
  readonly fallbacks: readonly ReflectionModelCandidate[]
}

export function kibitzerStartLadder(resolution: KibitzerStartResolution, refused: ReadonlySet<string>): readonly KibitzerStartCandidate[] {
  const head: ReflectionModelCandidate = {
    model: resolution.model,
    ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
  }
  const all = [head, ...resolution.fallbacks]
  const open = all.filter((candidate) => !refused.has(candidate.model))
  const ladder = open.length > 0 ? open : all
  return ladder.map((candidate, index) => ({
    model: candidate.model,
    ...(candidate.thinking === undefined ? {} : { thinking: candidate.thinking }),
    chain: childModelChainSpec({ model: candidate.model, fallbacks: ladder.slice(index + 1) }),
  }))
}
