export {
  createContentHash,
  getMatcherCacheStats,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  resetMatcherCache,
  shouldApplyRule,
} from "@oh-my-opencode/rules-core";
export type { MatchResult } from "@oh-my-opencode/rules-core";

export interface MatcherCacheStats {
  readonly entries: number;
}
