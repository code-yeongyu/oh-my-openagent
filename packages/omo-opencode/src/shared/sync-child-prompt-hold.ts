import { createSemanticPromptDedupeKey } from "@oh-my-opencode/utils/prompt-async-gate/semantic-dedupe"
import { finishPromptReservation, getPromptReservation } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { handedBackSyncSessions, syncSubagentSessions } from "../features/claude-code-session-state"
import { getDelegatedChildSessionBootstrap } from "./delegated-child-session-bootstrap"
import { releasePromptAsyncReservation } from "./prompt-async-gate"

type Model = { providerID: string; modelID: string }
type RecoveryHold = { token: symbol; source: string; dedupeKey: string }
type Execution = { recoveryHold?: RecoveryHold; signal: AbortSignal; dedupeKey: string; model: Model | undefined; text: string; startedAt: number }
const executions = new Map<string, Set<Execution>>()
const OWNER = "call-omo-agent:sync"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function modelOf(value: unknown): Model | undefined {
  return record(value) && typeof value.providerID === "string" && typeof value.modelID === "string"
    ? { providerID: value.providerID, modelID: value.modelID } : undefined
}

export function registerSyncChildPromptExecution(sessionID: string, signal: AbortSignal, input: {
  body: { model?: unknown; parts: readonly { type: string; text?: string }[] }
}): (completed?: boolean) => void {
  const execution: Execution = {
    signal,
    startedAt: Date.now(),
    dedupeKey: createSemanticPromptDedupeKey(input),
    model: modelOf(input.body.model),
    text: input.body.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n"),
  }
  const active = executions.get(sessionID) ?? new Set<Execution>()
  active.add(execution)
  executions.set(sessionID, active)
  return (completed = false) => {
    if (completed && !execution.signal.aborted && active.size === 1 && active.has(execution)
      && executions.get(sessionID) === active && syncSubagentSessions.has(sessionID)
      && !handedBackSyncSessions.has(sessionID)) {
      const current = getPromptReservation(sessionID)
      const recovery = execution.recoveryHold
      if (current && recovery && current.token === recovery.token && current.source === recovery.source
        && current.dedupeKey === recovery.dedupeKey && typeof current.expiresAt === "number") {
        // Completion ends the ACK protection window. Retain semantic dedupe;
        // only this invocation's already-settled recovery reservation may end.
        finishPromptReservation(sessionID, current, false, 0)
      }
    }
    active.delete(execution)
    if (active.size === 0 && executions.get(sessionID) === active) executions.delete(sessionID)
  }
}

/** Recovery authority is bounded to one live invocation and one already-sent model. */
export function captureSyncChildPromptHold(sessionID: string, failedModel?: Model) {
  const reservation = getPromptReservation(sessionID)
  if (reservation?.source !== OWNER) return undefined
  const matches = [...(executions.get(sessionID) ?? [])].filter((entry) => (
    entry.dedupeKey === reservation.dedupeKey && entry.model !== undefined
    && (!failedModel || entry.model.providerID === failedModel.providerID && entry.model.modelID === failedModel.modelID)
    && entry.text.length > 0
  ))
  if (matches.length !== 1) return undefined
  const execution = matches[0]
  if (!execution?.model) return undefined
  const capturedModel = { ...execution.model }
  const isExecutionCurrent = () => executions.get(sessionID)?.size === 1 && executions.get(sessionID)?.has(execution) === true
    && !execution.signal.aborted && syncSubagentSessions.has(sessionID)
    && !handedBackSyncSessions.has(sessionID)
  const isCurrent = () => isExecutionCurrent() && getDelegatedChildSessionBootstrap(sessionID) !== undefined
  if (!isCurrent()) return undefined

  const isTerminalFailure = (response: unknown): boolean => {
    if (!isCurrent()) return false
    const messages = Array.isArray(response) ? response : record(response) && Array.isArray(response.data) ? response.data : []
    let latestUser = -1
    for (let index = 0; index < messages.length; index++) {
      if (record(messages[index]) && record(messages[index].info) && messages[index].info.role === "user") latestUser = index
    }
    const user = messages[latestUser]
    if (!record(user) || !record(user.info) || !record(user.info.time)
      || typeof user.info.time.created !== "number" || user.info.time.created < execution.startedAt) return false
    if (!record(user) || !Array.isArray(user.parts) || !user.parts.some((part) => record(part)
      && part.type === "text" && typeof part.text === "string" && part.text.includes(execution.text))) return false
    const assistant = messages.slice(latestUser + 1).filter((message) => record(message)
      && record(message.info) && message.info.role === "assistant").at(-1)
    if (!record(assistant) || !record(assistant.info) || !assistant.info.error) return false
    if (typeof assistant.info.parentID !== "string" || assistant.info.parentID !== user.info.id) return false
    const model = modelOf(assistant.info)
    return model?.providerID === execution.model?.providerID && model?.modelID === execution.model?.modelID
  }

  return {
    model: capturedModel,
    isExecutionCurrent,
    isCurrent,
    isTerminalFailure,
    captureRecoveryHold(source: string, input: { body?: unknown }): (() => void) | undefined {
      if (!isExecutionCurrent() || !source.startsWith("model-fallback:") && !source.startsWith("runtime-fallback:")) return
      const captured = getPromptReservation(sessionID)
      if (captured?.source !== source || captured.dedupeKey !== createSemanticPromptDedupeKey(input)) return
      return () => {
        const current = getPromptReservation(sessionID)
        if (!isExecutionCurrent() || current?.token !== captured.token || current.source !== source
          || current.dedupeKey !== captured.dedupeKey || typeof current.expiresAt !== "number") return
        execution.recoveryHold = { token: current.token, source, dedupeKey: current.dedupeKey }
      }
    },
    release(source: string): "released" | "not-held" | "unsettled" | "superseded" {
      if (!isCurrent()) return "superseded"
      const current = getPromptReservation(sessionID)
      if (!current) return "not-held"
      if (current.token !== reservation.token || current.source !== OWNER) return "superseded"
      // Only the original dispatch's completed finally can write this expiry. Its
      // semantic-dedupe writes are already finished; never revoke an in-flight lease.
      if (typeof current.expiresAt !== "number") return "unsettled"
      return releasePromptAsyncReservation(sessionID, source, { reservedBy: OWNER }) ? "released" : "superseded"
    },
  }
}
