import { isRecord } from "@oh-my-opencode/utils"

import { log } from "../../shared/logger"

export type QuestionToolRef = {
  readonly sessionID: string
  readonly callID?: string
}

export type PendingQuestionProbeResult = {
  readonly state: "waiting" | "resolved"
  readonly detail?: string
}

export type QuestionVisibilityWatchdogDeps = {
  readonly probeQuestionToolState: (ref: QuestionToolRef) => Promise<PendingQuestionProbeResult>
  readonly showToast: (body: string) => Promise<void>
  readonly graceMs?: number
  readonly schedule?: (callback: () => void, ms: number) => () => void
}

export const QUESTION_VISIBILITY_DEFAULT_GRACE_MS = 30_000

const WATCHDOG_LOG_PREFIX = "[question-visibility-watchdog]"

type ScheduledCancel = () => void

function defaultSchedule(callback: () => void, ms: number): ScheduledCancel {
  const timer = setTimeout(callback, ms)
  return () => clearTimeout(timer)
}

function refKey(ref: QuestionToolRef): string {
  return `${ref.sessionID}:${ref.callID ?? ""}`
}

function buildToastBody(ref: QuestionToolRef): string {
  return [
    `The agent asked a question in session ${ref.sessionID} and is waiting for your answer.`,
    "If no question prompt is visible, reply to it as a normal chat message.",
  ].join(" ")
}

export function createQuestionVisibilityWatchdog(deps: QuestionVisibilityWatchdogDeps) {
  const graceMs = deps.graceMs ?? QUESTION_VISIBILITY_DEFAULT_GRACE_MS
  const schedule = deps.schedule ?? defaultSchedule
  const scheduled = new Map<string, ScheduledCancel>()
  let disposed = false

  async function runCheck(ref: QuestionToolRef): Promise<void> {
    try {
      const result = await deps.probeQuestionToolState(ref)
      if (result.state !== "waiting") {
        log(`${WATCHDOG_LOG_PREFIX} Question resolved before grace elapsed`, {
          sessionID: ref.sessionID,
          callID: ref.callID,
          detail: JSON.stringify(result),
        })
        return
      }
      await deps.showToast(buildToastBody(ref))
      log(`${WATCHDOG_LOG_PREFIX} Visibility toast emitted for pending question`, {
        sessionID: ref.sessionID,
        callID: ref.callID,
      })
    } catch (error) {
      log(`${WATCHDOG_LOG_PREFIX} Pending-question probe failed`, {
        sessionID: ref.sessionID,
        callID: ref.callID,
        error: String(error),
      })
    }
  }

  function onQuestionExecuted(ref: QuestionToolRef): void {
    if (disposed) return
    if (!ref.sessionID) return
    const key = refKey(ref)
    if (scheduled.has(key)) return
    log(`${WATCHDOG_LOG_PREFIX} Watching question execution`, {
      sessionID: ref.sessionID,
      callID: ref.callID,
      graceMs,
    })
    const cancel = schedule(() => {
      scheduled.delete(key)
      void runCheck(ref)
    }, graceMs)
    scheduled.set(key, cancel)
  }

  function dispose(): void {
    disposed = true
    for (const cancel of scheduled.values()) cancel()
    scheduled.clear()
  }

  return {
    onQuestionExecuted,
    dispose,
  }
}

type SessionMessagesClient = {
  session: {
    messages: (args: {
      path: { id: string }
      query?: { directory?: string }
    }) => Promise<unknown>
  }
}

const QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"])

function extractMessages(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) return response.data
  return Array.isArray(response) ? response : []
}

function messageInfo(message: unknown): Record<string, unknown> | undefined {
  if (!isRecord(message)) return undefined
  return isRecord(message.info) ? message.info : undefined
}

function messageParts(message: unknown): unknown[] {
  if (!isRecord(message)) return []
  const parts = message.parts
  return Array.isArray(parts) ? parts : []
}

function partMatchesQuestionCall(part: unknown, callID: string | undefined): boolean {
  if (!isRecord(part) || part.type !== "tool") return false
  const toolName = typeof part.tool === "string" ? part.tool : undefined
  if (!toolName || !QUESTION_TOOL_NAMES.has(toolName.toLowerCase())) return false
  if (callID === undefined) return true
  return part.callID === callID
}

function partIsAwaitingUser(part: unknown): boolean {
  if (!isRecord(part)) return false
  if (!isRecord(part.state)) return true
  const status = part.state.status
  return status === "pending" || status === "running"
}

export function createSessionMessageQuestionProbe(
  client: SessionMessagesClient,
  directory?: string,
): (ref: QuestionToolRef) => Promise<PendingQuestionProbeResult> {
  return async (ref) => {
    const response = await client.session.messages({
      path: { id: ref.sessionID },
      ...(directory ? { query: { directory } } : {}),
    })
    const messages = extractMessages(response)
    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messageInfo(messages[index])
      if (info?.role !== "assistant") continue
      for (const part of messageParts(messages[index])) {
        if (!partMatchesQuestionCall(part, ref.callID)) continue
        const status = isRecord(part) && isRecord(part.state) ? part.state.status : "<none>"
        return {
          state: partIsAwaitingUser(part) ? "waiting" : "resolved",
          detail: `status=${String(status)}`,
        }
      }
    }
    return { state: "resolved" }
  }
}
