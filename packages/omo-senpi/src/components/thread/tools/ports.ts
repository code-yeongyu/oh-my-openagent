import type { DiskSession } from "../address-book"
import type { ThreadTranscriptEntry } from "../reader"

export type ThreadHostSession = {
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly sessionPath?: string
  readonly cwd: string
  readonly name?: string
  readonly status?: "opening" | "open" | "closing" | "closed"
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** The already-running senpi multi-session host, expressed as its public command surface. */
export type ThreadHost = {
  readonly socket: string
  readonly listSessions: () => Promise<readonly ThreadHostSession[]>
  readonly openSession: (params: { readonly cwd?: string; readonly sessionPath?: string; readonly name?: string; readonly forkFrom?: string }) => Promise<ThreadHostSession>
  readonly getMessages: (sessionId: string) => Promise<readonly ThreadTranscriptEntry[]>
  readonly getState: (sessionId: string) => Promise<{ readonly isStreaming?: boolean; readonly activeTurnId?: string }>
  readonly prompt: (sessionId: string, message: string, options?: { readonly streamingBehavior?: "steer" | "followUp" }) => Promise<{ readonly turnId?: string }>
  readonly interrupt: (sessionId: string, turnId?: string) => Promise<{ readonly interrupted?: boolean; readonly turnId?: string }>
  readonly setSessionName: (sessionId: string, name: string) => Promise<void>
  readonly setModel: (sessionId: string, provider: string, modelId: string) => Promise<{ provider: string; id: string; name?: string }>
  readonly getAvailableModels: (sessionId: string) => Promise<readonly { provider: string; id: string; name?: string }[]>
  readonly setThinkingLevel: (sessionId: string, level: string, scope?: "session" | "turn") => Promise<void>
  readonly getAvailableThinkingLevels: (sessionId: string) => Promise<readonly string[]>
}

export type ThreadToolSurfaceOptions = {
  readonly host: ThreadHost
  readonly callerSessionId: () => string
  readonly callerWorkspaceRoot: () => string
  readonly stateDirectory: string
  readonly diskSessions?: () => readonly DiskSession[]
  readonly ensureHost?: () => Promise<void>
}


/** Placeholder the component supplies when the host passes no per-call caller identity. */
export const UNKNOWN_CALLER = "unknown-caller"
