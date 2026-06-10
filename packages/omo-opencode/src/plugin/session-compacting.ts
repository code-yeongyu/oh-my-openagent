import type { Hooks } from "@opencode-ai/plugin"

import { isCompactionAgent } from "../shared/compaction-marker"
import { log } from "../shared/logger"

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

type CompactionAutocontinueHandlerOptions = {
  readonly duplicateGuardMs?: number
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
  }
}
