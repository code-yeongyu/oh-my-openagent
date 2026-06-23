// ConfidenceScore: null when data unavailable, with reason
export interface ConfidenceScore {
  value: number | null // 0.0-1.0, null if no data
  factors: {
    extensionRatio: number | null // inCount/totalCount, null if totalCount=0
    proofChainDepth: number | null // normalized depth, null if no chain
    ruleStrength: number | null // avg rule strength, null if unknown
  }
  reason: string | null // reason if null (e.g. "no_data", "empty_chain")
}

// InconclusiveReason: why the state became inconclusive
export type InconclusiveReason =
  | "low_confidence" // confidence.value < threshold
  | "narrow_margin" // dominance margin < threshold
  | "circular_dependency" // cycle detected in proof chain
  | "no_data" // no analyzable data available

// DependencyInfo: inferential power analysis
export interface DependencyInfo {
  selfSufficient: boolean | null // null if unknown (empty chain)
  dependencyChain: string[] // list of defeasible conclusion dependencies
  hasCircularDependency: boolean // true if cycle detected
}

// AnalyzedProofChain: full extraction from raw proof chain
export interface AnalyzedProofChain {
  ruleIds: string[]
  antecedents: Map<string, string[]> // ruleId -> list of antecedent formulas
  depth: number // inference steps to reach conclusion
  hasCircularDependency: boolean
  allPremisesOrdinary: boolean | null // null if no premises
}

// DominanceResult: conclusion ranking output
export interface DominanceResult {
  ranking: Array<{ conclusion: string; score: number }> // sorted descending
  dominant: string | null // top conclusion, null if no clear winner
  margin: number // score[0] - score[1], 0 if < 2 conclusions
  isConclusive: boolean // margin >= configured threshold
}
