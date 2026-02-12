import type { AgreementLevel, CouncilMemberConfig, CouncilMemberStatus } from "./types"

export interface AthenaAssessment {
  agrees: boolean
  rationale: string
}

export interface SynthesizedFinding {
  summary: string
  details: string
  agreementLevel: AgreementLevel
  reportedBy: string[]
  assessment: AthenaAssessment
  isFalsePositiveRisk: boolean
}

export interface MemberProvenance {
  member: CouncilMemberConfig
  status: CouncilMemberStatus
  rawResponse?: string
  durationMs: number
}

export interface SynthesisResult {
  question: string
  findings: SynthesizedFinding[]
  memberProvenance: MemberProvenance[]
  totalFindings: number
  consensusCount: number
  outlierCount: number
}
