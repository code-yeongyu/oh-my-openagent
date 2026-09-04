import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  OMO_SENPI_TASK_RPC_CHILD,
  type ManagerStartSpec,
  type StartResult,
  type TaskManager,
} from "@oh-my-opencode/senpi-task"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { buildFallbackHandoff } from "./fallback-handoff"

type FallbackDelegateSettings = OmoTaskSettings["fallback_delegate"]

type RetryFallbackExhausted = {
  readonly sessionId: string
  readonly chainKey: string
  readonly from: string
  readonly lastError: string
  readonly exhaustionReason: "no-context-compatible-candidate"
  readonly rejectedCandidates: readonly {
    readonly selector: string
    readonly reason: string
  }[]
}

type FallbackEventContext = {
  readonly sessionManager: {
    getSessionId(): string
    getEntries(): readonly unknown[]
  }
}

export type FallbackDelegateDeps = {
  readonly manager: Pick<TaskManager, "start">
  readonly settings: FallbackDelegateSettings
  readonly logger: ComponentLogger
  readonly isRpcChild?: () => boolean
}

export function wireFallbackDelegate(pi: SenpiExtensionAPI, deps: FallbackDelegateDeps): void {
  if (!deps.settings.enabled) return
  const claimedTurns = new Set<string>()
  const isRpcChild = deps.isRpcChild ?? (() => process.env[OMO_SENPI_TASK_RPC_CHILD] === "1")

  pi.on("retry_fallback_exhausted", (payload, eventContext) => {
    try {
      if (isRpcChild()) return
      const event = parseExhaustion(payload)
      const context = parseContext(eventContext)
      if (event === undefined || context === undefined) return
      if (context.sessionManager.getSessionId() !== event.sessionId) return
      const model = deps.settings.model ?? event.rejectedCandidates
        .find((candidate) => candidate.reason === "context-unusable")
        ?.selector
      if (model === undefined || model.length === 0) return
      const handoff = buildFallbackHandoff({
        entries: context.sessionManager.getEntries(),
        maxBytes: deps.settings.max_handoff_bytes,
        recentTailMessages: deps.settings.recent_tail_messages,
        source: {
          chainKey: event.chainKey,
          from: event.from,
          lastError: event.lastError,
        },
      })
      if (handoff === undefined) return
      const claimKey = `${event.sessionId}\0${handoff.requestId}`
      if (claimedTurns.has(claimKey)) return
      claimedTurns.add(claimKey)

      const spec: ManagerStartSpec = {
        prompt: handoff.prompt,
        task_summary: "Recover a context-incompatible parent turn",
        parent_session_id: event.sessionId,
        root_session_id: event.sessionId,
        depth: 1,
        model,
        run_in_background: true,
      }
      void deps.manager.start(spec)
        .then((result) => logStartResult(deps.logger, result))
        .catch((error: unknown) => {
          deps.logger.warn("omo-senpi fallback delegate failed to start", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
    } catch (error) {
      deps.logger.warn("omo-senpi fallback delegate rejected malformed context", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

function parseExhaustion(value: unknown): RetryFallbackExhausted | undefined {
  const event = asRecord(value)
  if (
    event?.["type"] !== "retry_fallback_exhausted"
    || event["exhaustionReason"] !== "no-context-compatible-candidate"
    || typeof event["sessionId"] !== "string"
    || typeof event["chainKey"] !== "string"
    || typeof event["from"] !== "string"
    || typeof event["lastError"] !== "string"
    || !Array.isArray(event["rejectedCandidates"])
  ) {
    return undefined
  }
  const rejectedCandidates = event["rejectedCandidates"].flatMap((candidate) => {
    const entry = asRecord(candidate)
    return typeof entry?.["selector"] === "string" && typeof entry["reason"] === "string"
      ? [{ selector: entry["selector"], reason: entry["reason"] }]
      : []
  })
  return {
    sessionId: event["sessionId"],
    chainKey: event["chainKey"],
    from: event["from"],
    lastError: event["lastError"],
    exhaustionReason: "no-context-compatible-candidate",
    rejectedCandidates,
  }
}

function parseContext(value: unknown): FallbackEventContext | undefined {
  const context = asRecord(value)
  const sessionManager = asRecord(context?.["sessionManager"])
  const getSessionId = sessionManager?.["getSessionId"]
  const getEntries = sessionManager?.["getEntries"]
  if (typeof getSessionId !== "function" || typeof getEntries !== "function") return undefined
  const sessionId = Reflect.apply(getSessionId, sessionManager, [])
  const entries = Reflect.apply(getEntries, sessionManager, [])
  if (typeof sessionId !== "string" || !Array.isArray(entries)) return undefined
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
    },
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function logStartResult(logger: ComponentLogger, result: StartResult): void {
  if (result.kind === "started") {
    logger.info("omo-senpi fallback delegate started", { taskId: result.task_id })
    return
  }
  logger.warn("omo-senpi fallback delegate did not start", { kind: result.kind })
}
