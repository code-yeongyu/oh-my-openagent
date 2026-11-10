import { latestAssistantTurnBlocksInternalPrompt } from "@oh-my-opencode/utils/prompt-async-gate/pending-tool-turn"

import { isLastAssistantMessageAborted } from "../todo-continuation-enforcer/abort-detection"
import { ABORT_WINDOW_MS } from "../todo-continuation-enforcer/constants"
import { hasUnansweredQuestion } from "../todo-continuation-enforcer/pending-question-detection"
import type { MessageWithInfo } from "../todo-continuation-enforcer/types"

/**
 * Skip predicates shared by every hook that injects an internal prompt on
 * `session.idle` (todo-continuation-enforcer, goal). Keep one list here so the
 * hooks cannot drift apart again (#12976).
 */
export type TranscriptContinuationSkipReason =
  | "last-assistant-aborted"
  | "pending-question"
  | "pending-internal-response"

export function getTranscriptContinuationSkipReason(
  messages: MessageWithInfo[],
): TranscriptContinuationSkipReason | undefined {
  if (isLastAssistantMessageAborted(messages)) return "last-assistant-aborted"
  if (hasUnansweredQuestion(messages)) return "pending-question"
  if (latestAssistantTurnBlocksInternalPrompt(messages)) return "pending-internal-response"
  return undefined
}

/** Milliseconds since the abort when it is still inside the abort window, otherwise undefined. */
export function getAbortWindowElapsedMs(abortDetectedAt: number | undefined, now: number): number | undefined {
  if (!abortDetectedAt) return undefined
  const elapsed = now - abortDetectedAt
  return elapsed < ABORT_WINDOW_MS ? elapsed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function extractSessionErrorInfo(error: unknown): { name?: string; message?: string } | undefined {
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

export function isAbortSessionErrorName(name: string | undefined): boolean {
  return name === "MessageAbortedError" || name === "AbortError"
}
