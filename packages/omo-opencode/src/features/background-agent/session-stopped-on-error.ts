import { isRecord } from "../../shared/record-type-guard"

type SessionMessage = {
  info?: { role?: string; error?: unknown }
}

// A session.error whose session then goes idle with no output is only transient if something
// (runtime-fallback, context-window recovery) re-prompts it. This many consecutive idle polls
// that still end on the errored assistant turn means nothing did. At the 3s poll interval this
// is ~30s, above runtime-fallback's worst-case reserved-session backoff (0.5s + ... + 3s = 10.5s).
export const MIN_ERRORED_IDLE_POLLS = 10

function describeSessionError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error)
  }
  const data = isRecord(error.data) ? error.data : undefined
  const message = typeof data?.message === "string" ? data.message
    : typeof error.message === "string" ? error.message
      : undefined
  const name = typeof error.name === "string" ? error.name : undefined
  return [name, message].filter((value): value is string => Boolean(value)).join(": ") || "unknown error"
}

export function getStoppedSessionError(messages: readonly SessionMessage[]): string | undefined {
  const latest = messages[messages.length - 1]
  if (latest?.info?.role !== "assistant") {
    return undefined
  }
  const error = latest.info.error
  if (error === undefined || error === null) {
    return undefined
  }
  return describeSessionError(error)
}
