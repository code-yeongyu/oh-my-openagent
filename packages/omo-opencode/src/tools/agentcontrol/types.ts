export const AGENT_CONTROL_LEADER_ACTIONS = [
  "Execute",
  "Explore",
  "Plan",
  "Research",
  "Dispatch",
  "Send",
  "List",
  "Collect",
  "Peek",
  "Cancel",
] as const

export const AGENT_CONTROL_WORKER_ACTIONS = ["Report"] as const

export type AgentControlAction =
  | (typeof AGENT_CONTROL_LEADER_ACTIONS)[number]
  | (typeof AGENT_CONTROL_WORKER_ACTIONS)[number]

export interface AgentControlRuntimeRequest {
  readonly project: string
  readonly owner: string
  readonly action: AgentControlAction
  readonly arguments: Readonly<Record<string, unknown>>
  readonly abort?: AbortSignal
}

export type AgentControlRuntime = (request: AgentControlRuntimeRequest) => Promise<string>
