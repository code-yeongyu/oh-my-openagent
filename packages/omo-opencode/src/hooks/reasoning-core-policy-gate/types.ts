type CandidateArgs = Record<string, unknown>

type CandidateContext = Record<string, unknown> & {
  subagentType?: string
}

type ToolExecuteBeforeInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteBeforeOutput = {
  args: Record<string, unknown>
}

type ToolExecuteBeforeHandler = (
  input: ToolExecuteBeforeInput,
  output: ToolExecuteBeforeOutput,
) => Promise<void>

type ToolExecuteAfterInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteAfterOutput = {
  output: string
}

type ToolExecuteAfterHandler = (
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
) => Promise<void>

export interface CandidateAction {
  tool: string
  sessionID: string
  args: CandidateArgs
  agent?: string
  context?: CandidateContext
}

export interface PolicyVerdict {
  allow: boolean
  reason?: string
  proofArtifact?: unknown
}

export interface ReasoningCoreRequest {
  candidate: CandidateAction
  sessionContext: Record<string, unknown>
}

export interface ReasoningCorePolicyGateHook {
  "tool.execute.before": ToolExecuteBeforeHandler
  "tool.execute.after"?: ToolExecuteAfterHandler
}
