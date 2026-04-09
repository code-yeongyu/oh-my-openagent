import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "./opencode-storage-paths"

type CompactionPartLike = {
  type?: unknown
}

type CompactionMessageLike = {
  agent?: unknown
  info?: {
    agent?: unknown
  }
  parts?: unknown
}

function isCompactionPart(part: unknown): boolean {
  return typeof part === "object" && part !== null && (part as CompactionPartLike).type === "compaction"
}

export function isCompactionAgent(agent: unknown): boolean {
  return typeof agent === "string" && agent.trim().toLowerCase() === "compaction"
}

export function hasCompactionPart(parts: unknown): boolean {
  return Array.isArray(parts) && parts.some((part) => isCompactionPart(part))
}

export function isCompactionMessage(message: CompactionMessageLike): boolean {
  return isCompactionAgent(message.info?.agent ?? message.agent) || hasCompactionPart(message.parts)
}

export function hasCompactionPartInStorage(messageID: string | undefined): boolean {
  if (!messageID) {
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) {
    return false
  }

  try {
    return readdirSync(partDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .some((fileName) => {
        try {
          const content = readFileSync(join(partDir, fileName), "utf-8")
          return isCompactionPart(JSON.parse(content))
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}
