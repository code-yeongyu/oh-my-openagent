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
    const statusResult = await client.session.status().catch((error) => {
      log(`[look_at] session.status error (treating as idle):`, error)
      return { data: undefined, error }
    })

    if (statusResult.error || !statusResult.data) {
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
