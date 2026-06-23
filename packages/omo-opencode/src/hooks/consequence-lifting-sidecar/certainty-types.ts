import type { ProofChainKind } from "../epistemic-state-interpreter/multi-plane-types"
import type { ProofStep } from "./consequence-graph"
import type { ContaminationAxis, ContaminationLevel } from "./contamination-types"

export type CertaintyLevel = "low" | "medium" | "high"

export interface CertaintyExtensionMembership {
  inCount: number
  totalCount: number
}

export interface SplitCertainty {
  framework_certainty: CertaintyLevel | null
  world_certainty: CertaintyLevel | null
}

export interface CertaintySplitInput {
  proofChainKind?: ProofChainKind | null
  extensionMembership?: CertaintyExtensionMembership | null
  proofChain?: ProofStep[] | null
  tags?: string[] | null
  contaminationLevel?: ContaminationLevel
  contaminationAxis?: ContaminationAxis | null
}
