import type { PromotionCandidate } from "../memory-core/types"
import type { ClaudeMemL1Adapter } from "../memory-provider-claude-mem/adapter"
import type { L1PromotionCandidateOptions } from "../memory-provider-core/types"

export interface DistillerResult {
  candidates: PromotionCandidate[]
  skipped_count: number
  source: "claude-mem"
}

export async function distillFromL1(
  adapter: ClaudeMemL1Adapter,
  options?: L1PromotionCandidateOptions,
): Promise<DistillerResult> {
  const rawCandidates = await adapter.getPromotionCandidates(options)

  return {
    candidates: rawCandidates,
    skipped_count: 0,
    source: "claude-mem",
  }
}
