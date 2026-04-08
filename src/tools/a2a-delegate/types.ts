export interface OpenfangAgentEntry {
  id: string
  name: string
  state: string
}

export interface OpenfangListAgentsResponse {
  agents: OpenfangAgentEntry[]
}

export interface OpenfangSendMessageResponse {
  response: string
}

export interface OpenfangHealthResponse {
  status: string
}

export interface A2aDelegateArgs {
  agent: string
  prompt: string
  session_id?: string
}
