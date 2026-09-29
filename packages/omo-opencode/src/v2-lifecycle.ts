import type { Plugin } from "@opencode/plugin"
import { isRecord } from "@oh-my-opencode/utils"
import {
  clearSessionAgent,
  getMainSessionID,
  setMainSession,
  subagentSessions,
} from "./features/claude-code-session-state"
import { clearSessionPromptParams } from "./shared/session-prompt-params-state"
import { clearInternalMarkerCache } from "./v2-request"
import { clearPromptSessionState } from "./v2-prompt"

export function extractDeletedSessionID(event: unknown): string | undefined {
  if (!isRecord(event) || event.type !== "session.deleted") return undefined
  for (const key of ["properties", "data", "payload"]) {
    const container = event[key]
    if (!isRecord(container)) continue
    const sessionID = container.sessionID ?? container.sessionId
    if (typeof sessionID === "string" && sessionID.length > 0) return sessionID
  }
  if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
    return event.sessionID
  }
  return undefined
}

function extractSessionInfo(event: unknown): { id?: string; parentID?: string } {
  if (!isRecord(event)) return {}
  for (const key of ["properties", "data", "payload"]) {
    const container = event[key]
    if (!isRecord(container)) continue
    const info = container.info
    if (isRecord(info)) {
      return {
        ...(typeof info.id === "string" ? { id: info.id } : {}),
        ...(typeof info.parentID === "string" ? { parentID: info.parentID } : {}),
      }
    }
    if (typeof container.sessionID === "string") return { id: container.sessionID }
  }
  return {}
}

function clearAllSessionState(sessionID: string): void {
  clearSessionPromptParams(sessionID)
  clearInternalMarkerCache(sessionID)
  clearPromptSessionState(sessionID)
  clearSessionAgent(sessionID)
  subagentSessions.delete(sessionID)
  if (getMainSessionID() === sessionID) setMainSession(undefined)
}

export async function registerLifecycleV2(
  ctx: Plugin.Context,
  extra?: { onSessionDeleted?: ((sessionID: string) => void)[] },
): Promise<() => void> {
  const controller = new AbortController()
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      if (!isRecord(event)) continue
      if (event.type === "session.created") {
        const info = extractSessionInfo(event)
        if (!info.id) continue
        if (info.parentID) {
          subagentSessions.add(info.id)
        } else {
          setMainSession(info.id)
        }
        continue
      }
      const sessionID = extractDeletedSessionID(event)
      if (!sessionID) continue
      clearAllSessionState(sessionID)
      for (const handler of extra?.onSessionDeleted ?? []) {
        try {
          handler(sessionID)
        } catch {
          // Per-hook cleanup must not break the shared subscription.
        }
      }
    }
  })().catch(() => {})
  return () => controller.abort()
}
