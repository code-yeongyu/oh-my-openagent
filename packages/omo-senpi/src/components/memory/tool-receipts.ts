// Out-of-band commit receipts for the MCP tool surface (plan IC-17). The MCP
// server process has no senpi session state, so after a successful commit it
// writes the commit metadata to an identity-scoped receipt file keyed by the
// unforgeable toolCallId the extension's tool_call bridge injected; the
// extension's tool_result handler reads and deletes that file to reach the
// notice channel. No commit metadata ever rides the tool result text: senpi's
// MCP output guard truncates large results, which would silently drop exactly
// the largest edits. This module stays free of senpi runtime imports so the
// MCP bundle can inline it.

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

export interface MemoryToolReceipt {
  readonly version: 1
  readonly toolCallId: string
  readonly sha: string
  readonly subject: string
  readonly affectedPaths: readonly string[]
}

export function toolReceiptPath(receiptsDir: string, toolCallId: string): string {
  const key = createHash("sha256").update(toolCallId).digest("hex").slice(0, 32)
  return join(receiptsDir, `${key}.json`)
}

export async function writeToolReceipt(receiptsDir: string, receipt: MemoryToolReceipt): Promise<void> {
  await mkdir(receiptsDir, { recursive: true, mode: 0o700 })
  const target = toolReceiptPath(receiptsDir, receipt.toolCallId)
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}

/**
 * Read-and-delete the receipt for a finished tool call. Returns undefined when
 * no receipt exists (direct-surface call, failed call, or standalone MCP use)
 * and when the payload fails validation; a payload whose embedded toolCallId
 * does not match the file's call is corrupt and is consumed without emitting.
 */
export async function consumeToolReceipt(
  receiptsDir: string,
  toolCallId: string,
): Promise<MemoryToolReceipt | undefined> {
  const path = toolReceiptPath(receiptsDir, toolCallId)
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
  await unlink(path).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
  try {
    const parsed: unknown = JSON.parse(raw)
    return isReceiptFor(parsed, toolCallId) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isReceiptFor(value: unknown, toolCallId: string): value is MemoryToolReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1
    && record.toolCallId === toolCallId
    && typeof record.sha === "string"
    && record.sha.length > 0
    && typeof record.subject === "string"
    && Array.isArray(record.affectedPaths)
    && record.affectedPaths.every((path) => typeof path === "string")
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
