export {
  createContentHash,
  getMatcherCacheStats,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  resetMatcherCache,
  shouldApplyRule,
} from "@oh-my-opencode/rules-engine";
export type { MatchResult } from "@oh-my-opencode/rules-engine";

export interface MatcherCacheStats {
  readonly entries: number;
}
