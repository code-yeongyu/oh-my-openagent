import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../../shared"

type Client = ReturnType<typeof createOpencodeClient>

export interface PollOptions {
  pollIntervalMs?: number
  timeoutMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 120_000

export async function pollSessionUntilIdle(
  client: Client,
  sessionID: string,
  options?: PollOptions,
): Promise<void> {
  const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const status = client.session.status
    if (typeof status !== "function") {
      log("[look_at] session.status unavailable (treating as idle)")
      return
    }

    const statusResult = await status.call(client.session).catch((error) => {
      log(`[look_at] session.status error (treating as idle):`, error)
      return { data: undefined, error }
    })

    const statusError = "error" in statusResult ? statusResult.error : undefined
    if (statusError || !statusResult.data) {
      return
    }

    const sessionStatus = statusResult.data[sessionID]
    if (!sessionStatus || sessionStatus.type === "idle") {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`[look_at] Polling timed out after ${timeout}ms waiting for session ${sessionID} to become idle`)
}
