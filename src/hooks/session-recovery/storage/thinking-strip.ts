import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import type { StoredPart } from "../types"
import { log, isSqliteBackend, deletePart } from "../../../shared"
import { normalizeSDKResponse } from "../../../shared"

type OpencodeClient = PluginInput["client"]

export function stripThinkingParts(messageID: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: stripThinkingParts (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyRemoved = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart
      if (THINKING_TYPES.has(part.type)) {
        unlinkSync(filePath)
        anyRemoved = true
      }
    } catch {
      continue
    }
  }

  return anyRemoved
}

export async function stripThinkingPartsAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as Array<{ parts?: Array<{ type: string; id: string }> }>, { preferResponseOnMissingData: true })

    const targetMsg = messages.find((m) => {
      const info = (m as Record<string, unknown>)["info"] as Record<string, unknown> | undefined
      return info?.["id"] === messageID
    })
    if (!targetMsg?.parts) return false

    let anyRemoved = false
    for (const part of targetMsg.parts) {
      if (THINKING_TYPES.has(part.type) && part.id) {
        const deleted = await deletePart(client, sessionID, messageID, part.id)
        if (deleted) anyRemoved = true
      }
    }

    return anyRemoved
  } catch (error) {
    log("[session-recovery] stripThinkingPartsAsync failed", { error: String(error) })
    return false
  }
}
