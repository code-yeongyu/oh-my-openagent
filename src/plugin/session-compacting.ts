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

async function runCompactionStep(
  hook: string,
  sessionID: string,
  action: () => Promise<void> | void,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    log("[session-compacting] hook execution failed", {
      hook,
      sessionID,
      error: String(error),
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
): CompactionAutocontinueHook {
  return async (
    input: CompactionAutocontinueInput,
    output: CompactionAutocontinueOutput,
  ): Promise<void> => {
    if (isCompactionAgent(input.agent)) {
      output.enabled = false
      return
    }

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
