import { isRecord, log } from "../../shared"
import type { OpencodeClient } from "./opencode-client"

export type SessionActivityResolver = (sessionID: string) => Promise<Date | undefined>

function dateFromMillis(value: unknown): Date | undefined {
  if (typeof value !== "number") return undefined
  if (!Number.isFinite(value) || value < 0) return undefined
  return new Date(value)
}

export function extractSessionActivityDate(sessionInfo: unknown): Date | undefined {
  if (!isRecord(sessionInfo)) return undefined
  const time = isRecord(sessionInfo.time) ? sessionInfo.time : undefined
  return dateFromMillis(time?.updated) ?? dateFromMillis(sessionInfo.time_updated)
}

export async function getSessionActivityFromClient(
  client: OpencodeClient,
  sessionID: string,
  directory?: string,
): Promise<Date | undefined> {
  const sessionGet = client.session.get
  if (typeof sessionGet !== "function") return undefined

  try {
    const response = await sessionGet({
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
    })
    const sessionInfo = isRecord(response) && "data" in response ? response.data : response
    return extractSessionActivityDate(sessionInfo)
  } catch (error) {
    if (error instanceof Error) {
      log("[background-agent] Failed to read session activity:", { sessionID, error: error.message })
      return undefined
    }
    log("[background-agent] Failed to read session activity:", { sessionID, error })
    return undefined
  }
}
