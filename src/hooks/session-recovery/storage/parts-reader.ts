import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { PART_STORAGE } from "../constants"
import type { StoredPart } from "../types"
import { isSqliteBackend } from "../../../shared"
import { isRecord } from "../../../shared/record-type-guard"

type OpencodeClient = PluginInput["client"]

export function readParts(messageID: string): StoredPart[] {
  if (isSqliteBackend()) return []

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: StoredPart[] = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(partDir, file), "utf-8")
      parts.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return parts
}

export async function readPartsFromSDK(
  client: OpencodeClient,
  sessionID: string,
  messageID: string
): Promise<StoredPart[]> {
  try {
    const response = await client.session.message({
      path: { id: sessionID, messageID },
    })

    const data: unknown = response.data
    if (!isRecord(data)) return []

    const rawParts = data.parts
    if (!Array.isArray(rawParts)) return []

    return rawParts
      .map((part: unknown) => {
        if (!isRecord(part) || typeof part.id !== "string" || typeof part.type !== "string") return null
        return { ...part, sessionID, messageID } as StoredPart
      })
      .filter((part): part is StoredPart => part !== null)
  } catch {
    return []
  }
}
