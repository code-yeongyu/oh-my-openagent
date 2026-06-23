import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import type { ImplementationSafetyValidation } from "./safety-validation-types"
import type { CertaintyLevel } from "./certainty-types"
import type { PolicyCompletenessResult } from "./completeness-types"
import type { CatastrophicClassification } from "./catastrophic-risk-types"
import type { ContaminationResult } from "./contamination-types"
import type { PolicyBundle, BundleSelection } from "./policy-bundle-types"
import type { DeliberativeTriple, ExtendedPolicyStatus, FrameworkStatus, ImplementationStatus, WorldStatus } from "./formalization-types"
import type { HumilityReport } from "./repair-humility-types"
import type { VOIResult } from "./voi-types"

export type ConclusionRole =
  | "decision"
  | "consequence"
  | "mitigation"
  | "compensation"
  | "override"
  | "guardrail"
  | "trigger"
  | "repair_obligation"
  | "structural_constraint"
  | "info_event"
  | "condition"
  | "premise"

export type CausalRelation =
  | "causes"
  | "risks"
  | "enables"
  | "prevents"
  | "mitigates"
  | "compensates"
  | "overrides"
  | "guardrails"
  | "invalidates"
  | "repairs"

export type TemporalHorizon = "immediate" | "short" | "medium"

export type ForeseeabilityLevel = "high" | "medium" | "low"

export type ControlLevel = "high" | "partial" | "low"

export type LiftStrength = "strong_lift" | "medium_lift" | "weak_lift" | "no_lift"

export type ConsequenceEpistemicState = "established" | "residual_live_risk" | "excluded"

export type MitigationStatus = "unmitigated" | "partially_mitigated" | "sufficiently_mitigated"

export type PolicyStatus =
  | "core_accepted_selectable"
  | "core_accepted_conditioned"
  | "core_accepted_burdened"
  | "core_accepted_blocked"
  | "core_rejected"

export type PolicyQualifier =
  | "giustificabile_in_stato_di_necessita"
  | "normativamente_burdened"
  | "ammissibile_solo_se_condizionata"
  | "preferibile_ma_non_certo"
  | "plausibile_sotto_necessita"
  | "operativamente_necessaria_con_residuo"
  | "non_selezionabile_infeasible"
  | "catastroficamente_bloccato"

export interface AttributionCriteria {
  directness: "direct" | "mediated" | "remote"
  foreseeability: ForeseeabilityLevel
  controllability: ControlLevel
  affectsVulnerable: boolean
  horizon: TemporalHorizon
}

export interface ConsequenceEdge {
  from: string
  to: string
  relation: CausalRelation
  attribution: AttributionCriteria
  liftStrength: LiftStrength
}

export interface ConsequenceGraph {
  decisions: string[]
  edges: ConsequenceEdge[]
}

export interface ForwardBurden {
  conclusion: string
  liftStrength: LiftStrength
  epistemicState: ConsequenceEpistemicState
  normativeTag: string
  mitigationStatus: MitigationStatus
  mitigatedBy: string[]
}

export interface ForwardBenefit {
  conclusion: string
  liftStrength: LiftStrength
  epistemicState: ConsequenceEpistemicState
  normativeTag: string
}

export interface MitigationBinding {
  mitigation: string
  targetBurden: string
  effectiveness: MitigationStatus
  required: boolean
}

export interface DecisionSlot {
  name: string
  candidates: string[]
  maxSelectable: number
}

export interface DecisionProfile {
  decision: string
  coreStatus: "accepted" | "rejected" | "undecided"
  coreCombined: number
  framework_certainty?: CertaintyLevel | null
  world_certainty?: CertaintyLevel | null
  catastrophicGated?: boolean
  forwardBurdens: ForwardBurden[]
  forwardBenefits: ForwardBenefit[]
  mitigations: MitigationBinding[]
  requiredConditions: string[]
  policyStatus: PolicyStatus
  qualifiers: PolicyQualifier[]
}

export interface QualifiedPolicy {
  primaryDecision: string
  requiredConditions: string[]
  requiredMitigations: string[]
  profile: DecisionProfile
  alternativesConsidered: Array<{ decision: string; reason: string }>
  residualRisks: string[]
  completeness?: PolicyCompletenessResult
  implementationSafety?: ImplementationSafetyValidation
  formalization?: {
    frameworkStatus: FrameworkStatus
    worldStatus: WorldStatus
    implementationStatus: ImplementationStatus
    extendedStatus: ExtendedPolicyStatus
    triples: DeliberativeTriple[]
  }
}

export interface SidecarCatastrophicInfo {
  classifications: CatastrophicClassification[]
  blocked?: string[]
}

export interface SidecarBundleInfo {
  bundle: PolicyBundle
  selection: BundleSelection
}

export interface SidecarContaminationInfo {
  results: ContaminationResult[]
}

export interface SidecarVOIInfo {
  result: VOIResult
}

export interface SidecarHumilityInfo {
  report: HumilityReport
}

export interface SidecarInput {
  processed: ProcessedConclusion[]
  proofArtifact: unknown
  sessionID: string
  callID: string
  catastrophicBlockEnabled?: boolean
}

export interface SidecarOutput {
  policies: QualifiedPolicy[]
  profiles: DecisionProfile[]
  graph: ConsequenceGraph
  catastrophic?: SidecarCatastrophicInfo
  bundle?: SidecarBundleInfo
  contamination?: SidecarContaminationInfo
  voi?: SidecarVOIInfo
  humility?: SidecarHumilityInfo
}
