import { extractMessageList, hasNewUserTurnForTargetAgent, hasRecentUserTurnForTargetAgent } from "./message-inspection"
import { log } from "../../shared/logger"
import { sleepWithDelay } from "./session-status"

type SessionClient = {
  session: {
    messages: (input: { path: { id: string } }) => Promise<unknown>
  }
}

export async function fetchMessages(args: {
  client: SessionClient
  sessionID: string
}): Promise<Array<Record<string, unknown>>> {
  const response = await args.client.session.messages({ path: { id: args.sessionID } })
  return extractMessageList(response)
}

export async function verifySwitchObserved(args: {
  client: SessionClient
  sessionID: string
  targetAgent: string
  baselineCount: number
}): Promise<boolean> {
  const { client, sessionID, targetAgent, baselineCount } = args
  const delays = [100, 300, 800, 1500] as const

  for (const delay of delays) {
    await sleepWithDelay(delay)
    try {
      const messages = await fetchMessages({ client, sessionID })
      if (hasNewUserTurnForTargetAgent({ messages, targetAgent, baselineCount })) {
        return true
      }
    } catch (error) {
      log("[agent-switch] Verification read failed", {
        sessionID,
        error: String(error),
      })
    }
  }

  return false
}

export async function shouldClearAsAlreadyApplied(args: {
  client: SessionClient
  sessionID: string
  targetAgent: string
}): Promise<boolean> {
  const { client, sessionID, targetAgent } = args

  try {
    const messages = await fetchMessages({ client, sessionID })
    return hasRecentUserTurnForTargetAgent({ messages, targetAgent })
  } catch {
    return false
  }
}
