import { createHash } from "node:crypto"

import { hasInternalInitiatorMarker } from "../internal-initiator-marker"
import { log } from "../logger"
import { getRecentPromptDispatch } from "./recent-dispatches"
import type { InternalPromptDispatchResult } from "./types"

const MAX_PROMPT_DEDUPE_DEPTH = 64

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalizePromptInputForDedupe(
  key: string,
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (key === "signal") {
    return "[AbortSignal]"
  }
  if (typeof value === "function") {
    return `[Function:${value.name}]`
  }
  if (depth > MAX_PROMPT_DEDUPE_DEPTH) {
    return "[MaxDepth]"
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]"
    }
    seen.add(value)
    try {
      return value.map((entry) => canonicalizePromptInputForDedupe("", entry, seen, depth + 1))
    } finally {
      seen.delete(value)
    }
  }
  if (!isPlainRecord(value)) {
    return value
  }
  if (seen.has(value)) {
    return "[Circular]"
  }

  seen.add(value)
  try {
    const canonicalEntries: Array<[string, unknown]> = []
    for (const entryKey of Object.keys(value).sort()) {
      canonicalEntries.push([
        entryKey,
        canonicalizePromptInputForDedupe(entryKey, value[entryKey], seen, depth + 1),
      ])
    }
    return Object.fromEntries(canonicalEntries)
  } finally {
    seen.delete(value)
  }
}

function isContinuationTextPartLike(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }
  if (value.type !== "text" || typeof value.text !== "string") {
    return false
  }
  if (!hasInternalInitiatorMarker(value.text)) {
    return false
  }

  if (!isPlainRecord(value.metadata)) {
    return false
  }
  return value.metadata.compaction_continue === true
}

function hasContinuationPromptIntent(input: unknown): boolean {
  if (!isPlainRecord(input) || !isPlainRecord(input.body) || !Array.isArray(input.body.parts)) {
    return false
  }
  return input.body.parts.some((part) => isContinuationTextPartLike(part))
}

function normalizePromptInputForSemanticDedupe(input: unknown): unknown {
  if (hasContinuationPromptIntent(input)) {
    return {
      __omo_internal_intent: "continuation",
    }
  }
  return canonicalizePromptInputForDedupe("", input)
}

function stringifyPromptInputForDedupe(input: unknown): string {
  try {
    const serialized = JSON.stringify(normalizePromptInputForSemanticDedupe(input))
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
