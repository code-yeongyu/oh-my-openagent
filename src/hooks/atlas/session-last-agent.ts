import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { getMessageDir, isSqliteBackend, normalizeSDKResponse } from "../../shared"
import { hasCompactionPartInStorage, isCompactionMessage } from "../../shared/compaction-marker"

type SessionMessagesClient = {
  session: {
    messages: (input: { path: { id: string } }) => Promise<unknown>
  }
}

function getLastAgentFromMessageDir(messageDir: string): string | null {
  try {
    const messages = readdirSync(messageDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => {
        try {
          const content = readFileSync(join(messageDir, fileName), "utf-8")
          const parsed = JSON.parse(content) as { id?: string; agent?: unknown; time?: { created?: unknown } }
          return {
            fileName,
            id: parsed.id,
            agent: parsed.agent,
            createdAt: typeof parsed.time?.created === "number" ? parsed.time.created : Number.NEGATIVE_INFINITY,
          }
        } catch {
          return null
        }
      })
      .filter((message): message is { fileName: string; id: string | undefined; agent: unknown; createdAt: number } => message !== null)
      .sort((left, right) => (right?.createdAt ?? 0) - (left?.createdAt ?? 0) || (right?.fileName ?? "").localeCompare(left?.fileName ?? ""))

    for (const message of messages) {
      if (!message) continue
      if (isCompactionMessage({ agent: message.agent }) || hasCompactionPartInStorage(message?.id)) {
        continue
      }

      if (typeof message.agent === "string") {
        return message.agent.toLowerCase()
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
    try {
      const response = await client.session.messages({ path: { id: sessionID } })
      const messages = normalizeSDKResponse(response, [] as Array<{
        id?: string
        info?: { agent?: string; time?: { created?: number } }
        parts?: Array<{ type?: string }>
      }>, {
        preferResponseOnMissingData: true,
      }).sort((left, right) => {
        const leftTime = (left as { info?: { time?: { created?: number } } }).info?.time?.created ?? Number.NEGATIVE_INFINITY
        const rightTime = (right as { info?: { time?: { created?: number } } }).info?.time?.created ?? Number.NEGATIVE_INFINITY
        if (leftTime !== rightTime) {
          return rightTime - leftTime
        }

        const leftId = typeof left.id === "string" ? left.id : ""
        const rightId = typeof right.id === "string" ? right.id : ""
        return rightId.localeCompare(leftId)
      })

      for (const message of messages) {
        if (isCompactionMessage(message)) {
          continue
        }

        const agent = message.info?.agent
        if (typeof agent === "string") {
          return agent.toLowerCase()
        }
      }
    } catch {
      return null
    }

    return null
  }

  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return null

  return getLastAgentFromMessageDir(messageDir)
}
