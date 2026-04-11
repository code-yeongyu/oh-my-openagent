import { log } from "../../shared"
import type { OpencodeClient } from "./opencode-client"

export async function abortWithTimeout(
  client: OpencodeClient,
  sessionID: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      client.session.abort({ path: { id: sessionID } }).then(() => "aborted" as const),
      new Promise<"timed_out">((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve("timed_out")
        }, timeoutMs)
      }),
    ])

    if (result === "timed_out") {
      log("[background-agent] Session abort timed out; continuing cleanup:", {
        sessionID,
        timeoutMs,
      })
      return false
    }

    return true
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
