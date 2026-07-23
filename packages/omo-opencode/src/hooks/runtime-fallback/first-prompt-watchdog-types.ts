import type { FallbackOwnershipTransfer } from "./first-prompt-watchdog-ownership"

export type WatchdogEventDecision =
  | { readonly kind: "consume-terminal"; readonly sessionID: string }
  | { readonly kind: "defer-terminal"; readonly sessionID: string }
  | { readonly kind: "discard-terminal"; readonly sessionID: string }
  | { readonly kind: "inspect-terminal"; readonly sessionID: string }
  | { readonly kind: "resolve-terminal"; readonly sessionID: string }

export type ArmedWatchdog = {
  readonly sessionID: string
  readonly model: string | undefined
  readonly agent: string | undefined
  readonly wasSubagent: boolean
  readonly generation: number
  readonly sessionGeneration: number
  readonly deadlineAt: number
}

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string, messageID?: string): WatchdogEventDecision | undefined
  onFallbackOwnershipTransferred(sessionID: string): FallbackOwnershipTransfer | undefined
  onAssistantProgress(sessionID: string, parentMessageID?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
  onFallbackCompleted(sessionID: string): void
  onSessionTerminal(sessionID: string, eventType?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
  resolveDeferredTerminal(sessionID: string, currentRequestActive: boolean | undefined): WatchdogEventDecision | undefined
  dispose(): void
}
