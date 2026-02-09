import type { PluginInput } from "@opencode-ai/plugin"
import {
  SESSION_READY_POLL_INTERVAL_MS,
  SESSION_READY_TIMEOUT_MS,
} from "../../shared/tmux"
import { log } from "../../shared"
import { parseSessionStatusMap } from "./session-status-parser"

type OpencodeClient = PluginInput["client"]

export async function waitForSessionReady(params: {
  client: OpencodeClient
  sessionId: string
}): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < SESSION_READY_TIMEOUT_MS) {
    try {
      const statusResult = await params.client.session.status({ path: undefined })
      const allStatuses = parseSessionStatusMap(statusResult.data)

      if (allStatuses[params.sessionId]) {
        log("[tmux-session-manager] session ready", {
          sessionId: params.sessionId,
          status: allStatuses[params.sessionId].type,
          waitedMs: Date.now() - startTime,
        })
        return true
      }
    } catch (error) {
      log("[tmux-session-manager] session status check error", { error: String(error) })
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, SESSION_READY_POLL_INTERVAL_MS)
    })
  }

  log("[tmux-session-manager] session ready timeout", {
    sessionId: params.sessionId,
    timeoutMs: SESSION_READY_TIMEOUT_MS,
  })
  return false
}
