import type { ProofStep } from "./consequence-graph"

export type ImplementationSafetyStatus = "implementationSafe" | "implementationUnsafe"

export type ImplementationSafetyViolationKind =
  | "missing_required_step"
  | "unaccepted_required_step"
  | "blocked_required_step"
  | "implementation_path_burden"

export interface ImplementationSafetyViolation {
  kind: ImplementationSafetyViolationKind
  conclusion: string
  message: string
  relatedConclusions: string[]
}

export interface ImplementationSafetyValidation {
  status: ImplementationSafetyStatus
  violations: ImplementationSafetyViolation[]
}

export interface ImplementationSafetyConclusionState {
  status: string
  blocked: boolean
  tags: string[]
  proofChain: ProofStep[]
}
