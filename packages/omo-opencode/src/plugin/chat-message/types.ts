export type FirstMessageVariantGate = {
  readonly shouldOverride: (sessionID: string) => boolean
  readonly markApplied: (sessionID: string) => void
}

export type ChatMessagePart = {
  readonly type: string
  readonly text?: string
  readonly [key: string]: unknown
}

export type ChatMessageHandlerOutput = {
  readonly message: Record<string, unknown>
  readonly parts: ChatMessagePart[]
}

export type ChatMessageInput = {
  readonly sessionID: string
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
}

export type StartWorkHookOutput = {
  readonly parts: Array<{ readonly type: string; readonly text?: string }>
}

export type SessionModelOverride = { readonly providerID: string; readonly modelID: string }

export type WorkStartingCommand = "start-work" | "ralph-loop" | "ulw-loop"

type ChatMessageHook = {
  "chat.message"?: (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput,
  ) => Promise<void>
}

type StopContinuationGuard = {
  "chat.message"?: (input: ChatMessageInput) => Promise<void>
  stop?: (sessionID: string) => void
  isStopped: (sessionID: string) => boolean
  clear: (sessionID: string) => void
}

type RalphLoopHook = {
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: {
      readonly ultrawork?: boolean
      readonly maxIterations?: number
      readonly completionPromise?: string
      readonly strategy?: "continue" | "reset"
    },
  ) => boolean | void
  resumeLoop?: (sessionID: string) => boolean
  cancelLoop: (sessionID: string) => boolean | void
}

type GoalHook = {
  setGoal: (sessionID: string, objective: string) => { readonly objective: string; readonly status: string } | null
  getGoal: (sessionID: string) => { readonly objective: string; readonly status: string } | null
  pauseGoal: (sessionID: string) => { readonly objective: string; readonly status: string } | null
  resumeGoal: (sessionID: string) => { readonly objective: string; readonly status: string } | null
  clearGoal: (sessionID: string) => boolean
  markComplete: (sessionID: string) => { readonly objective: string; readonly status: string } | null
}

type TodoContinuationEnforcerHook = {
  cancelAllCountdowns: () => void
}

export type ChatMessageHooks = {
  modelFallback?: ChatMessageHook | null
  stopContinuationGuard?: StopContinuationGuard | null
  backgroundNotificationHook?: ChatMessageHook | null
  runtimeFallback?: ChatMessageHook | null
  keywordDetector?: ChatMessageHook | null
  thinkMode?: ChatMessageHook | null
  claudeCodeHooks?: ChatMessageHook | null
  autoSlashCommand?: ChatMessageHook | null
  noSisyphusGpt?: ChatMessageHook | null
  noHephaestusNonGpt?: ChatMessageHook | null
  hephaestusAgentsMdInjector?: ChatMessageHook | null
  startWork?: ChatMessageHook | null
  ralphLoop?: RalphLoopHook | null
  goal?: GoalHook | null
  todoContinuationEnforcer?: TodoContinuationEnforcerHook | null
}
