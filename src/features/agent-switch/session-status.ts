import { log } from "../../shared/logger"

type SessionClient = {
  session: {
    status?: () => Promise<unknown>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getSessionStatusType(statusResponse: unknown, sessionID: string): string | undefined {
  if (typeof statusResponse !== "object" || statusResponse === null) {
    return undefined
  }

  const root = statusResponse as Record<string, unknown>
  const data = (typeof root.data === "object" && root.data !== null)
    ? root.data as Record<string, unknown>
    : root

  const entry = data[sessionID]
  if (typeof entry !== "object" || entry === null) {
    return undefined
  }

  const entryType = (entry as Record<string, unknown>).type
  return typeof entryType === "string" ? entryType : undefined
}

export async function waitForSessionIdle(args: {
  client: SessionClient
  sessionID: string
  timeoutMs?: number
}): Promise<boolean> {
  const { client, sessionID, timeoutMs = 15000 } = args
  if (!client.session.status) {
    return true
  }

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const statusResponse = await client.session.status()
      const statusType = getSessionStatusType(statusResponse, sessionID)
      // /session/status only tracks non-idle sessions in SessionStatus.list().
      // Missing entry means idle.
      if (!statusType || statusType === "idle") {
        return true
      }
    } catch (error) {
      log("[agent-switch] Session status check failed", {
        sessionID,
        error: String(error),
      })
      return true
    }

    await sleep(200)
  }

  return false
}

export async function sleepWithDelay(ms: number): Promise<void> {
  await sleep(ms)
}
