export const SWITCHABLE_AGENT_NAMES = ["atlas", "prometheus", "sisyphus", "hephaestus"] as const

export type SwitchableAgentName = (typeof SWITCHABLE_AGENT_NAMES)[number]

export interface SwitchAgentArgs {
  agent: string
  context: string
}

export interface SwitchAgentInput {
  targetAgent: string
  preserveContext?: boolean
  handoffMessage?: string
}

export interface SwitchAgentResult {
  success: boolean
  previousAgent: string
  currentAgent: string
  contextPreserved: boolean
  newSessionID: string
  promptDelivered: boolean
  tuiNavigated: boolean
  errors: string[]
}

export interface HandoffSourceAgent {
  name: string
  sessionID: string
  messageID: string
}

export interface SessionMessagePart {
  type: string
  text?: string
}

export interface SessionMessage {
  info?: {
    role?: string
  }
  parts?: SessionMessagePart[]
}

export interface SwitchAgentClient {
  session: {
    create: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
    promptAsync: (input: {
      path: { id: string }
      body: { agent?: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    messages?: (input: { path: { id: string } }) => Promise<unknown>
  }
}
