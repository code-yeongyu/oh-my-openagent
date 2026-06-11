import type { TargetHookApi } from "./hook-registration"
import type { HostKind } from "../host-contract"
import { TargetPromptGate } from "./target-prompt-gate"

const COMPACTION_CONTINUATION =
  "Context compaction completed. Continue the active work from the preserved summary and pending tasks."

function sessionID(payload: unknown, context: unknown): string {
  for (const value of [payload, context]) {
    if (typeof value !== "object" || value === null) continue
    for (const key of ["sessionID", "sessionId", "id"]) {
      const candidate = (value as Record<string, unknown>)[key]
      if (typeof candidate === "string" && candidate.length > 0) return candidate
    }
  }
  return "target-session"
}

export function registerTargetContinuation(
  host: Exclude<HostKind, "opencode">,
  api: TargetHookApi & { sendUserMessage(content: string): void | Promise<void> },
): TargetPromptGate {
  const gate = new TargetPromptGate((message) => api.sendUserMessage(message))
  const handler = (payload: unknown, context: unknown) =>
    gate.dispatch(sessionID(payload, context), "compaction-continuation", COMPACTION_CONTINUATION)
  api.on("session_compact", handler)
  if (host === "oh-my-pi") api.on("auto_compaction_end", handler)
  return gate
}

export function notifyTargetBackgroundCompletion(
  gate: TargetPromptGate,
  session: string,
  taskID: string,
): Promise<"dispatched" | "coalesced"> {
  return gate.dispatch(session, `background:${taskID}`, `Background task ${taskID} completed. Review its result and continue.`)
}
