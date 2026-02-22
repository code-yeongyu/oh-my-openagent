import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { StoredMessage } from "../hook-message-injector"

export function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

function hasFullAgentAndModel(message: StoredMessage): boolean {
  return !!message.agent &&
    !isCompactionAgent(message.agent) &&
    !!message.model?.providerID &&
    !!message.model?.modelID
}

function hasPartialAgentOrModel(message: StoredMessage): boolean {
  const hasAgent = !!message.agent && !isCompactionAgent(message.agent)
  const hasModel = !!message.model?.providerID && !!message.model?.modelID
  return hasAgent || hasModel
}

export function findNearestMessageExcludingCompaction(messageDir: string): StoredMessage | null {
  try {
    const files = readdirSync(messageDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse()

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const parsed = JSON.parse(content) as StoredMessage
        if (hasFullAgentAndModel(parsed)) {
          return parsed
        }
      } catch {
        continue
      }
    }

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const parsed = JSON.parse(content) as StoredMessage
        if (hasPartialAgentOrModel(parsed)) {
          return parsed
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
