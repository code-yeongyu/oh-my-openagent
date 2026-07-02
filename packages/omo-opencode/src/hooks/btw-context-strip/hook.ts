import { log } from "../../shared/logger"

import { computeBtwStripIndices, hasDetectableBtwMarker } from "./predicates"
import type { BtwMarkerPredicate, MessageRole, MessageWithParts } from "./predicates"

// NOTE: This hook strips /btw pairs from normal model-request payloads only.
// OpenCode's compaction pipeline (experimental.session.compacting) does NOT route
// through experimental.chat.messages.transform, so a compaction summary MAY retain
// /btw content. This is a known limitation (NARROW+DISCLOSE branch, spike task 1).

type BtwContextStripOutput = { messages: MessageWithParts[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessageRole(message: unknown): MessageRole | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const info = message["info"]
  if (!isRecord(info)) {
    return undefined
  }

  const role = info["role"]
  return role === "user" || role === "assistant" || role === "tool" ? role : undefined
}

function getMessageParts(message: unknown): unknown[] {
  if (!isRecord(message)) {
    return []
  }

  const parts = message["parts"]
  return Array.isArray(parts) ? parts : []
}

function safeIsMarked(message: unknown, isMarked: BtwMarkerPredicate): boolean {
  try {
    return isMarked(message as MessageWithParts) === true
  } catch (error) {
    log("[btw-context-strip] marker predicate failed", { error: String(error) })
    return false
  }
}

function isMarkedFailClosed(message: unknown, isMarked: BtwMarkerPredicate): boolean {
  return safeIsMarked(message, isMarked) || hasDetectableBtwMarker(message)
}

function hasToolPairPart(message: unknown): boolean {
  return getMessageParts(message).some((part) => {
    if (!isRecord(part)) {
      return false
    }

    const type = part["type"]
    return type === "tool_use" || type === "tool_result"
  })
}


function computeFailClosedStripIndices(
  messages: MessageWithParts[],
  isMarked: BtwMarkerPredicate,
): Set<number> {
  const stripIndices = new Set<number>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!isMarkedFailClosed(message, isMarked)) {
      continue
    }

    const answerIndices: number[] = []
    let hasLaterUserMessage = false

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor]
      const role = getMessageRole(candidate)

      if (role === "user") {
        hasLaterUserMessage = true
        break
      }

      answerIndices.push(cursor)
    }

    if (!hasLaterUserMessage && answerIndices.length === 0) {
      continue
    }

    stripIndices.add(index)
    for (const answerIndex of answerIndices) {
      stripIndices.add(answerIndex)
    }
  }

  return stripIndices
}

function addPredicateStripIndices(
  stripIndices: Set<number>,
  messages: MessageWithParts[],
  isMarked: BtwMarkerPredicate,
): void {
  try {
    const predicateIndices = computeBtwStripIndices(messages, isMarked)
    for (const index of predicateIndices) {
      stripIndices.add(index)
    }
  } catch (error) {
    log("[btw-context-strip] predicate strip computation failed", { error: String(error) })
  }
}

function removeUnsafeToolAnswerIndices(
  stripIndices: Set<number>,
  messages: MessageWithParts[],
  isMarked: BtwMarkerPredicate,
): Set<number> {
  const safeStripIndices = new Set(stripIndices)

  for (const index of stripIndices) {
    const message = messages[index]
    if (isMarkedFailClosed(message, isMarked)) {
      continue
    }

    if (!hasToolPairPart(message)) {
      continue
    }

    safeStripIndices.delete(index)
    log("[btw-context-strip] skipped stripping tool-bearing answer message", { index })
  }

  return safeStripIndices
}

function removeMessagesInPlace(messages: MessageWithParts[], stripIndices: Set<number>): void {
  const descendingIndices = Array.from(stripIndices).sort((left, right) => right - left)
  for (const index of descendingIndices) {
    messages.splice(index, 1)
  }
}

function applyFailClosedStrip(output: BtwContextStripOutput, isMarked: BtwMarkerPredicate): void {
  try {
    if (!Array.isArray(output.messages)) {
      return
    }

    const stripIndices = computeFailClosedStripIndices(output.messages, isMarked)
    removeMessagesInPlace(output.messages, stripIndices)
  } catch (error) {
    log("[btw-context-strip] fail-closed strip failed, clearing all messages", { error: String(error) })
    try {
      output.messages.length = 0
    } catch (clearError) {
      log("[btw-context-strip] in-place clear failed, replacing messages", { error: String(clearError) })
      output.messages = []
    }
  }
}

export function createBtwContextStripHook(isMarked: BtwMarkerPredicate) {
  return async function btwContextStripTransform(
    _input: unknown,
    output: BtwContextStripOutput,
  ): Promise<void> {
    try {
      if (!Array.isArray(output.messages)) {
        return
      }

      const stripIndices = computeFailClosedStripIndices(output.messages, isMarked)
      addPredicateStripIndices(stripIndices, output.messages, isMarked)

      if (stripIndices.size === 0) {
        return
      }

      const safeStripIndices = removeUnsafeToolAnswerIndices(stripIndices, output.messages, isMarked)
      removeMessagesInPlace(output.messages, safeStripIndices)
    } catch (error) {
      log("[btw-context-strip] unexpected strip failure", { error: String(error) })
      applyFailClosedStrip(output, isMarked)
    }
  }
}
