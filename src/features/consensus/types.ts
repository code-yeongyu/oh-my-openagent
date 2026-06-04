import type { VoterCandidate } from "../../shared/model-lineage"

export type ConsensusTriggerType = "explicit" | "pre_question_gate" | "post_test_gate"

export type ResolvedVoterCandidate = {
  lineage: string
  providerID: string
  modelID: string
  variant: string | undefined
}

export type VoterPosition = {
  lineage: string
  model: string
  providerID: string | undefined
  variant: string | undefined
  status: "ok" | "error" | "timeout"
  text: string
  reasoning?: string
  durationMs: number
  errorMessage?: string
}

export function isUsableVoterPosition(voter: VoterPosition): boolean {
  return voter.status === "ok" && voter.text.trim().length > 0
}

export type ConsensusResult = {
  triggerType: ConsensusTriggerType
  callerModel: string | undefined
  callerLineage: string | undefined
  voters: VoterPosition[]
  advisoryOnly: boolean
  startedAt: string
  finishedAt: string
  totalDurationMs: number
}

export type ConsensusInput = {
  prompt: string
  callerModel?: string
  count?: number
  triggerType?: ConsensusTriggerType
  parentSessionID: string
  parentDirectory?: string
  voterTimeoutMs?: number
  excludeLineages?: ReadonlyArray<string>
  candidates?: ReadonlyArray<VoterCandidate>
}
