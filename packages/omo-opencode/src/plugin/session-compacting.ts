import type { Hooks } from "@opencode-ai/plugin"

import { isCompactionAgent, isCompactionMessage } from "../shared/compaction-marker"
import { log } from "../shared/logger"
import { normalizeSDKResponse } from "../shared/normalize-sdk-response"

type SessionCompactingHook = NonNullable<Hooks["experimental.session.compacting"]>
type SessionCompactingInput = Parameters<SessionCompactingHook>[0]
type SessionCompactingOutput = Parameters<SessionCompactingHook>[1]

export type CompactionAutocontinueInput = {
  sessionID: string
  agent?: string
  model?: unknown
  provider?: unknown
  message?: unknown
  overflow?: boolean
}

export type CompactionAutocontinueOutput = {
  enabled: boolean
}

export type CompactionAutocontinueHook = (
  input: CompactionAutocontinueInput,
  output: CompactionAutocontinueOutput,
) => Promise<void>

type CompactionAutocontinueSessionClient = {
  readonly session: {
    messages(options: { path: { id: string } }): Promise<unknown>
    todo(options: { path: { id: string } }): Promise<unknown>
  }
}

type CompactionAutocontinueHandlerOptions = {
  readonly duplicateGuardMs?: number
  readonly client?: CompactionAutocontinueSessionClient
}

type SessionMessageLike = {
  readonly info?: {
    readonly id?: unknown
    readonly role?: unknown
    readonly agent?: unknown
    readonly finish?: unknown
    readonly error?: unknown
  }
  readonly parts?: unknown
}

type TodoLike = {
  readonly status?: unknown
}

type TimerHandleWithOptionalUnref = ReturnType<typeof setTimeout> & {
  readonly unref?: () => unknown
}

type CompactionHookDependencies = {
  compactionContextInjector?: {
    capture?: (sessionID: string) => Promise<void>
    inject?: (sessionID: string) => string
    restore?: (sessionID: string) => Promise<boolean>
  } | null
  compactionTodoPreserver?: {
    capture?: (sessionID: string) => Promise<void>
    restore?: (sessionID: string) => Promise<void>
  } | null
  claudeCodeHooks?: {
    "experimental.session.compacting"?: SessionCompactingHook
  } | null
}

const DEFAULT_AUTOCONTINUE_DUPLICATE_GUARD_MS = 10_000

async function runCompactionStep(
  hook: string,
  sessionID: string,
  action: () => Promise<void> | void,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    let errorText: string
    if (error instanceof Error) {
      errorText = `${error.name}: ${error.message}`
    } else {
      errorText = String(error)
    }
    log("[session-compacting] hook execution failed", {
      hook,
      sessionID,
      error: errorText,
    })
  }
}

function unrefTimer(timer: TimerHandleWithOptionalUnref, sessionID: string): void {
  const maybeUnref = timer.unref
  if (typeof maybeUnref !== "function") {
    return
  }

  try {
    maybeUnref.call(timer)
  } catch (error) {
    let errorText: string
    if (error instanceof Error) {
      errorText = `${error.name}: ${error.message}`
    } else {
      errorText = String(error)
    }
    log("[session-compacting] duplicate autocontinue guard timer unref failed", {
      sessionID,
      error: errorText,
    })
  }
}

function getMessageID(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined
  }
  const id = (message as { id?: unknown }).id
  return typeof id === "string" ? id : undefined
}

// Mirrors OpenCode 1.x's own loop-exit rule (session/prompt.ts): a turn is finished when it has a
// finish reason other than tool-calls/unknown and no tool parts. Anything else is mid-work.
function isCompletedAssistantTurn(message: SessionMessageLike): boolean {
  const info = message.info
  if (info?.role !== "assistant") {
    return false
  }
  if (typeof info.finish !== "string" || info.finish === "tool-calls" || info.finish === "unknown") {
    return false
  }
  if (info.error !== undefined && info.error !== null) {
    return false
  }
  const parts = Array.isArray(message.parts) ? message.parts : []
  return !parts.some((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "tool")
}

async function compactedTurnWasCompleted(
  client: CompactionAutocontinueSessionClient,
  sessionID: string,
  triggerMessageID: string | undefined,
): Promise<boolean> {
  const messages = normalizeSDKResponse(
    await client.session.messages({ path: { id: sessionID } }),
    [] as SessionMessageLike[],
  )
  const triggerIndex = triggerMessageID === undefined
    ? -1
    : messages.findIndex((message) => message.info?.id === triggerMessageID)
  const searchEnd = triggerIndex === -1 ? messages.length : triggerIndex

  for (let index = searchEnd - 1; index >= 0; index--) {
    const message = messages[index]
    if (isCompactionMessage(message)) {
      continue
    }
    return isCompletedAssistantTurn(message)
  }
  return false
}

async function hasIncompleteTodos(client: CompactionAutocontinueSessionClient, sessionID: string): Promise<boolean> {
  const todos = normalizeSDKResponse(await client.session.todo({ path: { id: sessionID } }), [] as TodoLike[])
  return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress")
}

async function shouldVetoAfterCompletedTurn(
  client: CompactionAutocontinueSessionClient | undefined,
  input: CompactionAutocontinueInput,
): Promise<boolean> {
  if (!client) {
    return false
  }
  try {
    if (!(await compactedTurnWasCompleted(client, input.sessionID, getMessageID(input.message)))) {
      return false
    }
    // The todo continuation enforcer skips an idle whose latest message is the compaction summary,
    // so open todos still need OpenCode's continue to resume.
    return !(await hasIncompleteTodos(client, input.sessionID))
  } catch (error) {
    log("[session-compacting] autocontinue completed-turn check failed; keeping autocontinue", {
      sessionID: input.sessionID,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return false
  }
}

export function createSessionCompactingHandler(
  hooks: CompactionHookDependencies,
): SessionCompactingHook {
  return async (
    input: SessionCompactingInput,
    output: SessionCompactingOutput,
  ): Promise<void> => {
    await runCompactionStep("compactionContextInjector.capture", input.sessionID, async () => {
      const capture = hooks.compactionContextInjector?.capture
      if (capture) {
        await capture(input.sessionID)
      }
    })
    await runCompactionStep("compactionTodoPreserver.capture", input.sessionID, async () => {
      const capture = hooks.compactionTodoPreserver?.capture
      if (capture) {
        await capture(input.sessionID)
      }
    })
    await runCompactionStep("claudeCodeHooks.experimental.session.compacting", input.sessionID, async () => {
      await hooks.claudeCodeHooks?.["experimental.session.compacting"]?.(input, output)
    })
    await runCompactionStep("compactionContextInjector.inject", input.sessionID, () => {
      const inject = hooks.compactionContextInjector?.inject
      const context = inject ? inject(input.sessionID) : undefined
      if (context) {
        output.context.push(context)
      }
    })
  }
}

export function createCompactionAutocontinueHandler(
  hooks: CompactionHookDependencies,
  options: CompactionAutocontinueHandlerOptions = {},
): CompactionAutocontinueHook {
  const duplicateGuardMs = options.duplicateGuardMs ?? DEFAULT_AUTOCONTINUE_DUPLICATE_GUARD_MS
  const guardedSessions = new Map<string, TimerHandleWithOptionalUnref>()

  function markAutocontinueAllowed(sessionID: string): void {
    const existingTimer = guardedSessions.get(sessionID)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer: TimerHandleWithOptionalUnref = setTimeout(() => {
      guardedSessions.delete(sessionID)
    }, duplicateGuardMs)
    guardedSessions.set(sessionID, timer)
    unrefTimer(timer, sessionID)
  }

  return async (
    input: CompactionAutocontinueInput,
    output: CompactionAutocontinueOutput,
  ): Promise<void> => {
    if (isCompactionAgent(input.agent)) {
      output.enabled = false
      return
    }

    if (guardedSessions.has(input.sessionID)) {
      output.enabled = false
      log("[session-compacting] suppressed duplicate compaction autocontinue", {
        sessionID: input.sessionID,
      })
      return
    }

    markAutocontinueAllowed(input.sessionID)

    await runCompactionStep("compactionContextInjector.restore", input.sessionID, async () => {
      const restore = hooks.compactionContextInjector?.restore
      if (restore) {
        await restore(input.sessionID)
      }
    })
    await runCompactionStep("compactionTodoPreserver.restore", input.sessionID, async () => {
      const restore = hooks.compactionTodoPreserver?.restore
      if (restore) {
        await restore(input.sessionID)
      }
    })

    if (await shouldVetoAfterCompletedTurn(options.client, input)) {
      output.enabled = false
      log("[session-compacting] suppressed compaction autocontinue after a completed turn", {
        sessionID: input.sessionID,
      })
    }
  }
}
