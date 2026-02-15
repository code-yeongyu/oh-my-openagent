import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { PART_STORAGE } from "../constants"
import type { StoredTextPart } from "../types"
import { generatePartId } from "./part-id"
import { log, isSqliteBackend, patchPart } from "../../../shared"

type OpencodeClient = PluginInput["client"]

export function injectTextPart(sessionID: string, messageID: string, text: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: injectTextPart (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const partId = generatePartId()
  const part: StoredTextPart = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

export async function injectTextPartAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string,
  text: string
): Promise<boolean> {
  const partId = generatePartId()
  const part: Record<string, unknown> = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    return await patchPart(client, sessionID, messageID, partId, part)
  } catch (error) {
    log("[session-recovery] injectTextPartAsync failed", { error: String(error) })
    return false
  }
}
