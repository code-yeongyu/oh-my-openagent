import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { getMessageDir, isSqliteBackend, normalizeSDKResponse } from "../../shared"

type SessionMessagesClient = {
  session: {
    messages: (input: { path: { id: string } }) => Promise<unknown>
  }
}

function isCompactionAgent(agent: unknown): boolean {
  return typeof agent === "string" && agent.toLowerCase() === "compaction"
}

function getLastAgentFromMessageDir(messageDir: string): string | null {
  try {
    const files = readdirSync(messageDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()

    for (let i = files.length - 1; i >= 0; i--) {
      const fileName = files[i]
      try {
        const content = readFileSync(join(messageDir, fileName), "utf-8")
        const parsed = JSON.parse(content) as { agent?: unknown }
        if (typeof parsed.agent === "string" && !isCompactionAgent(parsed.agent)) {
          return parsed.agent.toLowerCase()
        }
      } catch {
        continue
      }
    }
  } catch {
    return null
  }

  return null
}

export async function getLastAgentFromSession(
  sessionID: string,
  client?: SessionMessagesClient
): Promise<string | null> {
  if (isSqliteBackend() && client) {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as Array<{ info?: { agent?: string } }>, {
      preferResponseOnMissingData: true,
    })

    for (let i = messages.length - 1; i >= 0; i--) {
      const agent = messages[i].info?.agent
      if (typeof agent === "string" && !isCompactionAgent(agent)) {
        return agent.toLowerCase()
      }
    }

    return null
  }

  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return null

  return getLastAgentFromMessageDir(messageDir)
}
