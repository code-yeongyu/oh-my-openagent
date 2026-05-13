export const DEFAULT_SESSION_IDLE_SETTLE_MS = 150

export function settleAfterSessionIdle(ms = DEFAULT_SESSION_IDLE_SETTLE_MS): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

type SessionStatusClient = {
  session?: {
    status?: () => Promise<unknown>
  }
}

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getSessionStatusPayload(response: unknown): Record<string, unknown> {
  if (isRecord(response) && isRecord(response.data)) {
    return response.data
  }

  if (isRecord(response)) {
    return response
  }

  return {}
}

export function isActiveSessionStatusType(statusType: string): boolean {
  return ACTIVE_SESSION_STATUSES.has(statusType)
}

export async function isSessionActive(client: SessionStatusClient, sessionID: string): Promise<boolean> {
  if (typeof client.session?.status !== "function") {
    return false
  }

  try {
    const statusResult = await client.session.status()
    const status = getSessionStatusPayload(statusResult)[sessionID]
    if (!isRecord(status)) {
      return false
    }

    const statusType = status.type
    return typeof statusType === "string" && isActiveSessionStatusType(statusType)
  } catch {
    return false
  }
}

export async function shouldPromptAfterSessionIdle(
  client: SessionStatusClient,
  sessionID: string,
  settleMs = DEFAULT_SESSION_IDLE_SETTLE_MS,
): Promise<boolean> {
  await settleAfterSessionIdle(settleMs)
  return !(await isSessionActive(client, sessionID))
}
