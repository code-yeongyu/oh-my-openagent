import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CodexAgentOverride } from "./codex-agent-config"
import { isPlainRecord } from "./codex-cache-fs"
import { readTextIfExists, replaceTopLevelStringSetting } from "./preserved-agent-settings"

const RECEIPT_FILE = ".lazycodex-agent-models.json"

// What LazyCodex itself wrote per agent on the last sync: the bundled or omo.jsonc model, and the
// omo.jsonc reasoning when an override set it. An installed value that differs is a hand edit; one
// that matches follows the next bundled default, so a removed override does not stick forever.
export type AgentModelReceipt = CodexAgentOverride

export async function readAgentModelReceipts(codexHome: string): Promise<ReadonlyMap<string, AgentModelReceipt>> {
  const content = await readTextIfExists(receiptPath(codexHome))
  if (content === null) return new Map()
  const parsed = parseJson(content)
  if (!isPlainRecord(parsed)) return new Map()
  const receipts = new Map<string, AgentModelReceipt>()
  for (const [name, value] of Object.entries(parsed)) {
    if (!isPlainRecord(value)) continue
    const model = value["model"]
    const reasoningEffort = value["reasoningEffort"]
    receipts.set(name, {
      ...(typeof model === "string" ? { model } : {}),
      ...(typeof reasoningEffort === "string" ? { reasoningEffort } : {}),
    })
  }
  return receipts
}

export async function writeAgentModelReceipts(
  codexHome: string,
  receipts: ReadonlyMap<string, AgentModelReceipt>,
): Promise<void> {
  const path = receiptPath(codexHome)
  if (receipts.size === 0) {
    await rm(path, { force: true })
    return
  }
  await writeFile(path, `${JSON.stringify(Object.fromEntries(receipts), null, "\t")}\n`)
}

export async function applyAgentOverride(input: {
  readonly linkPath: string
  readonly override: CodexAgentOverride | undefined
}): Promise<void> {
  if (input.override === undefined) return
  let content = await readFile(input.linkPath, "utf8")
  if (input.override.model !== undefined) {
    content = replaceTopLevelStringSetting(content, "model", input.override.model, { insertIfMissing: true }).content
  }
  if (input.override.reasoningEffort !== undefined) {
    content = replaceTopLevelStringSetting(content, "model_reasoning_effort", input.override.reasoningEffort, {
      insertIfMissing: true,
    }).content
  }
  await writeFile(input.linkPath, content)
}

function receiptPath(codexHome: string): string {
  return join(codexHome, "agents", RECEIPT_FILE)
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
