import type { OpencodeClient } from "./opencode-client"

export const MIN_SESSION_GONE_POLLS = 3
export type SessionExistenceStatus = "exists" | "missing" | "unknown"

function isTransportDisconnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes("undefined is not an object") && message.includes("_client")
}

function extractErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error
  }

  if (typeof error !== "object" || error === null || !("message" in error)) {
    return undefined
  }

  return typeof error.message === "string" ? error.message : undefined
}

function extractErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined
  }

  return typeof error.status === "number" ? error.status : undefined
}

function isSessionNotFoundError(error: unknown): boolean {
  if (extractErrorStatus(error) === 404) {
    return true
  }

  const message = extractErrorMessage(error)?.toLowerCase()
  if (!message) {
    return false
  }

  return message.includes("not found") || message.includes("missing")
}

export async function checkSessionExistence(
  client: OpencodeClient,
  sessionID: string,
  directory?: string
): Promise<SessionExistenceStatus> {
  try {
    const response = await client.session.get({
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
    })

    if (response.error !== undefined && response.error !== null) {
      return isSessionNotFoundError(response.error) ? "missing" : "unknown"
    }

    return response.data != null ? "exists" : "missing"
  } catch (error) {
    // Transport disconnect (this._client undefined) means the session is gone
    if (isTransportDisconnectError(error)) {
      return "missing"
    }
    return isSessionNotFoundError(error) ? "missing" : "unknown"
  }
}

export async function verifySessionExists(
  client: OpencodeClient,
  sessionID: string,
  directory?: string
): Promise<boolean> {
  return await checkSessionExistence(client, sessionID, directory) !== "missing"
}
