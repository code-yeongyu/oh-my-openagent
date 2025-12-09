export interface MessageMeta {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  path?: {
    cwd: string
    root: string
  }
  tools?: Record<string, boolean>
}

export interface OriginalMessageContext {
  agent?: string
  model?: {
    providerID?: string
    modelID?: string
  }
  path?: {
    cwd?: string
    root?: string
  }
  tools?: Record<string, boolean>
}

export interface TextPart {
  id: string
  type: "text"
  text: string
  synthetic: boolean
  time: {
    start: number
    end: number
  }
  messageID: string
  sessionID: string
}
