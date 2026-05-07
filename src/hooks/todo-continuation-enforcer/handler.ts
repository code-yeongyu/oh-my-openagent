import type { PluginInput } from "@opencode-ai/plugin"

import type { BackgroundManager } from "../../features/background-agent"
import {
  clearContinuationMarker,
} from "../../features/run-continuation-state"
import { log } from "../../shared/logger"

import { DEFAULT_SKIP_AGENTS, HOOK_NAME } from "./constants"
import { armCompactionGuard } from "./compaction-guard"
import type { SessionStateStore } from "./session-state"
import { handleSessionIdle } from "./idle-event"
import { handleNonIdleEvent } from "./non-idle-events"
import { isTokenLimitError } from "./token-limit-detection"

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function extractSessionErrorInfo(error: unknown): { name?: string; message?: string } | undefined {
  if (!error) return undefined
  if (typeof error === "string") return { message: error }
  if (error instanceof Error) return { name: error.name, message: error.message }

  const root = asRecord(error)
  if (!root) return { message: String(error) }

  const data = asRecord(root.data)
  const nestedError = asRecord(root.error)
  const dataError = asRecord(data?.error)

  const name = getStringField(root, "name")
    ?? getStringField(data, "name")
    ?? getStringField(nestedError, "name")
    ?? getStringField(dataError, "name")

  const messageParts = [
    getStringField(root, "message"),
    getStringField(data, "message"),
    getStringField(nestedError, "message"),
    getStringField(dataError, "message"),
    getStringField(root, "code"),
    getStringField(nestedError, "code"),
    getStringField(dataError, "code"),
  ].filter((message): message is string => typeof message === "string")

  return { name, message: messageParts.join(" ") || undefined }
}

export function createTodoContinuationHandler(args: {
  ctx: PluginInput
  sessionStateStore: SessionStateStore
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
}): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const {
    ctx,
    sessionStateStore,
    backgroundManager,
    skipAgents = DEFAULT_SKIP_AGENTS,
    isContinuationStopped,
  } = args

  return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const error = extractSessionErrorInfo(props?.error)
      let shouldCancelCountdown = false
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = sessionStateStore.getState(sessionID)
        state.wasCancelled = true
        state.abortDetectedAt = Date.now()
        state.lastIncompleteCount = undefined
        state.lastInjectedAt = undefined
        state.awaitingPostInjectionProgressCheck = false
        state.stagnationCount = 0
        state.consecutiveFailures = 0
        shouldCancelCountdown = true
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      } else if (isTokenLimitError(error)) {
        const state = sessionStateStore.getState(sessionID)
        state.tokenLimitDetected = true
        shouldCancelCountdown = true
        log(`[${HOOK_NAME}] Token limit error detected via session.error`, { sessionID, errorName: error?.name, errorMessage: error?.message })
      }

      if (shouldCancelCountdown) {
        sessionStateStore.cancelCountdown(sessionID)
      }
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      sessionStateStore.startPruneInterval()
      await handleSessionIdle({
        ctx,
        sessionID,
        sessionStateStore,
        backgroundManager,
        skipAgents,
        isContinuationStopped,
      })
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        const state = sessionStateStore.getState(sessionID)
        const compactionEpoch = armCompactionGuard(state, Date.now())
        sessionStateStore.cancelCountdown(sessionID)
        log(`[${HOOK_NAME}] Session compacted: armed compaction guard`, { sessionID, compactionEpoch })
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        clearContinuationMarker(ctx.directory, sessionInfo.id)
      }
    }

    handleNonIdleEvent({
      eventType: event.type,
      properties: props,
      sessionStateStore,
    })
  }
}
