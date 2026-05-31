import { createHash } from "node:crypto"

import { log } from "../logger"
import { getRecentPromptDispatch } from "./recent-dispatches"
import type { InternalPromptDispatchResult } from "./types"

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalizePromptInputForDedupe(key: string, value: unknown): unknown {
  if (key === "signal") {
    return "[AbortSignal]"
  }
  if (typeof value === "function") {
    return `[Function:${value.name}]`
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizePromptInputForDedupe("", entry))
  }
  if (!isPlainRecord(value)) {
    return value
  }

  const canonicalEntries: Array<[string, unknown]> = []
  for (const entryKey of Object.keys(value).sort()) {
    canonicalEntries.push([
      entryKey,
      canonicalizePromptInputForDedupe(entryKey, value[entryKey]),
    ])
  }
  return Object.fromEntries(canonicalEntries)
}

function stringifyPromptInputForDedupe(input: unknown): string {
  try {
    const serialized = JSON.stringify(canonicalizePromptInputForDedupe("", input))
    return serialized ?? String(input)
  } catch (error) {
    const errorTag = error instanceof Error ? error.name : String(error)
    return `${String(input)}:[unserializable:${errorTag}]`
  }
}

export function createSemanticPromptDedupeKey(input: unknown): string {
  const fingerprint = stringifyPromptInputForDedupe(input)
  const digest = createHash("sha256").update(fingerprint, "utf8").digest("hex")
  return `semantic:${digest}`
}

export function coalesceRecentSemanticPromptDispatch(args: {
  readonly sessionID: string
  readonly dedupeKey: string
  readonly source: string
}): InternalPromptDispatchResult | undefined {
  const recentDispatch = getRecentPromptDispatch(args.sessionID, args.dedupeKey)
  if (!recentDispatch) {
    return undefined
  }

  log("[prompt-async-gate] prompt coalesced with recent semantic dispatch", {
    sessionID: args.sessionID,
    source: args.source,
    queuedBy: recentDispatch.source,
  })
  return { status: "queued", queuedBy: recentDispatch.source, position: 0 }
}
