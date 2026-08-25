export type BtwPromptRef = {
  readonly hasAttachments: boolean
  readonly input: string
  set: (input: string) => void
  submit: () => void
}

export type BtwSession = {
  id: string
  title: string
  agent?: string
  model?: {
    providerID: string
    id: string
  }
}

export type BtwSessionMessage = {
  info: {
    id: string
    role: "user" | "assistant"
    time?: {
      completed?: number
    }
  }
}

export type BtwCreateSessionInput = {
  title: string
  agent?: string
  model?: {
    providerID: string
    id: string
  }
  metadata: Record<string, unknown>
}

export type BtwSideControllerDependencies = {
  getCurrentSessionID: () => string | undefined
  getSession: (sessionID: string) => BtwSession | undefined
  getMessages: (sessionID: string) => BtwSessionMessage[]
  createSession: (input: BtwCreateSessionInput) => Promise<{
    id: string
    title: string
  }>
  navigateSession: (sessionID: string) => void
  abortSession: (sessionID: string) => Promise<void>
  deleteSession: (sessionID: string) => Promise<void>
  showToast: (message: string) => void
  requestRender: () => void
}

export type BtwSideState =
  | { phase: "closed" }
  | { phase: "creating"; parentSessionID: string }
  | { phase: "open"; parentSessionID: string; sideSessionID: string; owned: boolean }
  | { phase: "closing"; parentSessionID: string; sideSessionID: string; owned: boolean }

export type BtwSideRecord = {
  parentSessionID: string
  sideSessionID: string
  owned: boolean
}

