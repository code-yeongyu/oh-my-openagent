import type { OpencodeClient } from "./opencode-client"

export const MIN_SESSION_GONE_POLLS = 3

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

export async function verifySessionExists(client: OpencodeClient, sessionID: string): Promise<boolean> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })

    if (response.error !== undefined && response.error !== null) {
      return !isSessionNotFoundError(response.error)
    }

    return response.data != null
  } catch (error) {
    return !isSessionNotFoundError(error)
  }
}
