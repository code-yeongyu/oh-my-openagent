import { isRecord } from "./record-type-guard"
export const DEFAULT_SESSION_IDLE_SETTLE_MS = 150
export const DEFAULT_SESSION_STATUS_TIMEOUT_MS = 5_000

export function settleAfterSessionIdle(ms = DEFAULT_SESSION_IDLE_SETTLE_MS): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function withStatusTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`session.status() timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }
  })
}

type SessionStatusClient = {
  session?: {
    status?: () => Promise<unknown>
  }
}

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])



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

export async function isSessionActive(
  client: SessionStatusClient,
  sessionID: string,
  statusTimeoutMs: number = DEFAULT_SESSION_STATUS_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof client.session?.status !== "function") {
    return false
  }

  try {
    const statusResult = await withStatusTimeout(
      client.session.status(),
      statusTimeoutMs,
    )
    const status = getSessionStatusPayload(statusResult)[sessionID]
    if (!isRecord(status)) {
      return false
    }

    const statusType = status.type
    return typeof statusType === "string" && isActiveSessionStatusType(statusType)
  } catch (error) {
    if (error instanceof Error) {
      return false
    }

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
