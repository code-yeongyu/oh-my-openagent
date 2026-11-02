import { open } from "node:fs/promises"

import type { InputEffectStatus } from "./reconcile-turn"

/**
 * The receipt of ONE input, read from the session transcript where senpi writes it
 * (`rpc_client_message_admission`, the entries its own `get_effect_status { sessionPath }` reads).
 * Like senpi, it looks the exact id up: a newer entry can belong to another input (senpi's reopen seal
 * writes an older running input's `completed` after a newer input's `queued`). The scan walks back in
 * fixed chunks and stops at a cap, so a transcript without the receipt never loads whole.
 */

const ADMISSION_ENTRY = "rpc_client_message_admission"
const CHUNK_BYTES = 256 * 1024
export const MAX_RECEIPT_SCAN_BYTES = 8 * 1024 * 1024
const RECONCILED_OUTCOMES = new Set(["completed", "aborted", "interrupted_by_reopen", "deadline", "error"])
const ADMISSION_STATES: Readonly<Record<string, InputEffectStatus["state"]>> = {
  queued: "accepted",
  running: "applied",
  completed: "done",
}

export async function readInputReceipt(sessionPath: string, effectId: string): Promise<InputEffectStatus | undefined> {
  let file
  try {
    file = await open(sessionPath, "r")
  } catch {
    return undefined
  }
  try {
    const { size } = await file.stat()
    const floor = Math.max(0, size - MAX_RECEIPT_SCAN_BYTES)
    let end = size
    // Undecoded bytes of the line the previous (later) chunk began inside. Decoding only whole lines keeps a
    // multi-byte character (Hangul in a reason or detail) intact when a chunk boundary falls inside it.
    let carry = Buffer.alloc(0)
    while (end > floor) {
      const start = Math.max(floor, end - CHUNK_BYTES)
      const chunk = Buffer.alloc(end - start)
      await file.read(chunk, 0, chunk.length, start)
      const bytes = Buffer.concat([chunk, carry])
      // Only a chunk read from the true file start owns its first line; otherwise it continues backwards.
      const firstNewline = start === 0 ? -1 : bytes.indexOf(0x0a)
      if (start > 0 && firstNewline === -1) {
        carry = bytes
        end = start
        continue
      }
      carry = start === 0 ? Buffer.alloc(0) : bytes.subarray(0, firstNewline)
      const lines = bytes.subarray(firstNewline + 1).toString("utf8").split("\n")
      for (let index = lines.length - 1; index >= 0; index--) {
        const receipt = receiptOf(lines[index] ?? "", effectId)
        if (receipt !== undefined) return receipt
      }
      end = start
    }
    return undefined
  } finally {
    await file.close()
  }
}

function receiptOf(line: string, effectId: string): InputEffectStatus | undefined {
  if (!line.includes(ADMISSION_ENTRY) || !line.includes(effectId)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.type !== "custom" || parsed.customType !== ADMISSION_ENTRY || !isRecord(parsed.data)) return undefined
  const data = parsed.data
  if (data.clientMessageId !== effectId) return undefined
  const state = typeof data.state === "string" ? ADMISSION_STATES[data.state] : undefined
  if (state === undefined) return undefined
  const outcome = isRecord(data.outcome) ? data.outcome : undefined
  if (state !== "done" || outcome === undefined) return { state }
  // A dropped or cleared input never ran: it is a failed receipt, which reconciliation reads as no outcome.
  if (typeof outcome.kind !== "string" || !RECONCILED_OUTCOMES.has(outcome.kind)) return { state: "failed" }
  return {
    state,
    outcome: {
      kind: outcome.kind as NonNullable<InputEffectStatus["outcome"]>["kind"],
      ...(isRecord(outcome.deadline) ? { deadline: outcome.deadline } : {}),
      ...(typeof outcome.reason === "string" ? { reason: outcome.reason } : {}),
      ...(typeof outcome.detail === "string" ? { detail: outcome.detail } : {}),
      ...(typeof outcome.action === "string" ? { action: outcome.action } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
