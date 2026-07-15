import { log } from "../../shared"
import { isRecord } from "../../shared/record-type-guard"
import type { OpencodeClient } from "./opencode-client"

function getAbortResponseError(response: unknown): unknown | undefined {
  if (!isRecord(response)) return undefined
  const error = response.error
  return error === undefined || error === null ? undefined : error
}

export async function abortWithTimeout(
  client: OpencodeClient,
  sessionID: string,
  options: number | { readonly timeoutMs?: number; readonly directory?: string } = 10_000,
): Promise<boolean> {
  const timeoutMs = typeof options === "number" ? options : options.timeoutMs ?? 10_000
  const directory = typeof options === "number" ? undefined : options.directory
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      client.session.abort({
        path: { id: sessionID },
        ...(directory ? { query: { directory } } : {}),
      }).then(
        (response) => {
          const error = getAbortResponseError(response)
          if (error !== undefined) {
            log("[background-agent] Session abort returned an error response:", {
              sessionID,
              error,
            })
            return "failed" as const
          }
          return "aborted" as const
        },
        (error) => {
          log("[background-agent] Session abort failed:", {
            sessionID,
            error,
          })
          return "failed" as const
        },
      ),
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

    return result === "aborted"
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
