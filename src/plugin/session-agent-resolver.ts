import { log } from "../shared"

interface SessionMessage {
  info?: {
    agent?: string
    role?: string
  }
}

type SessionClient = {
  session: {
    messages: (opts: { path: { id: string } }) => Promise<{ data?: SessionMessage[] }>
  }
}

export async function resolveSessionAgent(
  client: SessionClient,
  sessionId: string,
): Promise<string | undefined> {
  try {
    const messagesResp = await client.session.messages({ path: { id: sessionId } })
    const messages = (messagesResp.data ?? []) as SessionMessage[]

    for (const msg of messages) {
      if (msg.info?.agent) {
        return msg.info.agent
      }
    }
  } catch (error) {
    log("[session-agent-resolver] Failed to resolve agent from session", {
      sessionId,
      error: String(error),
    })
  }
  return undefined
}
