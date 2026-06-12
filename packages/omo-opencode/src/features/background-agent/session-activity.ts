import { isRecord, log } from "../../shared"
import type { OpencodeClient } from "./opencode-client"

export type SessionActivityLookup =
  | { readonly type: "activity"; readonly activity: Date }
  | { readonly type: "missing" }
  | { readonly type: "unavailable" }

export type SessionActivityResolver = (sessionID: string) => Promise<SessionActivityLookup>

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

function sessionActivityLookupFromInfo(sessionInfo: unknown): SessionActivityLookup {
  const activity = extractSessionActivityDate(sessionInfo)
  return activity ? { type: "activity", activity } : { type: "missing" }
}

export async function getSessionActivityFromClient(
  client: OpencodeClient,
  sessionID: string,
  directory?: string,
): Promise<SessionActivityLookup> {
  if (typeof client.session.get !== "function") return { type: "missing" }

  try {
    const response = await client.session.get({
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
    })
    if (isRecord(response) && response.error !== undefined && response.error !== null) {
      log("[background-agent] Failed to read session activity:", { sessionID, error: response.error })
      return { type: "unavailable" }
    }

    const sessionInfo = isRecord(response) && "data" in response ? response.data : response
    return sessionActivityLookupFromInfo(sessionInfo)
  } catch (error) {
    if (error instanceof Error) {
      log("[background-agent] Failed to read session activity:", { sessionID, error: error.message })
      return { type: "unavailable" }
    }
    log("[background-agent] Failed to read session activity:", { sessionID, error })
    return { type: "unavailable" }
  }
}
