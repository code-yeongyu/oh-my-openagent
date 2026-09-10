import type { Message, Part } from "@opencode-ai/sdk"
import { isRecord } from "@oh-my-opencode/utils"

// Byte-stability contract (prefix-stability tail channel for R5/R6-style
// volatiles): dynamic injectors must confine churn to the payload tail. This
// helper strips previously injected tail messages before appending one fresh
// message, so re-invocation replaces rather than duplicates and the stable
// prefix bytes never move. Tag key below is pinned. Do not edit without review.
export const VOLATILE_TAIL_METADATA_KEY = "omo-volatile-tail"

export type VolatileTailMessage = {
  info: Message
  parts: Part[]
}

type PartWithMetadata = Part & {
  metadata?: Record<string, unknown>
}

function readMetadata(part: Part): Record<string, unknown> | undefined {
  const metadata = (part as PartWithMetadata).metadata
  return isRecord(metadata) ? metadata : undefined
}

function isVolatileTailPart(part: Part): boolean {
  return readMetadata(part)?.[VOLATILE_TAIL_METADATA_KEY] === true
}

function isVolatileTailMessage(message: VolatileTailMessage): boolean {
  return message.parts.length > 0 && message.parts.every(isVolatileTailPart)
}

export function stripVolatileTail(messages: VolatileTailMessage[]): number {
  let removed = 0
  while (messages.length > 0) {
    const last = messages[messages.length - 1]
    if (last === undefined || !isVolatileTailMessage(last)) break
    messages.pop()
    removed += 1
  }
  return removed
}

export function tagVolatileTailParts(parts: Part[]): Part[] {
  return parts.map((part) => ({
    ...part,
    synthetic: true,
    metadata: { ...readMetadata(part), [VOLATILE_TAIL_METADATA_KEY]: true },
  }))
}

export function appendVolatileTailMessage(
  messages: VolatileTailMessage[],
  message: VolatileTailMessage,
): void {
  stripVolatileTail(messages)
  messages.push({ info: message.info, parts: tagVolatileTailParts(message.parts) })
}
