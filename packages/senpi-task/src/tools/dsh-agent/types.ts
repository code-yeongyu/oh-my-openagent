import type { DshRunner, DshRunOutcome } from "../../runners/dsh"

export type CallDshAgentDeps = {
  readonly runner: DshRunner
}

export type CallDshAgentDetails = {
  readonly stopReason: string
  readonly exitCode: number | null
  readonly verified: boolean
  readonly verify?: string
  readonly evidence?: string
}
