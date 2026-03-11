import type { MessageWithParts } from "./types"

type ToolPartShape = {
  type: string
  callID?: string
  tool?: string
  state?: {
    status?: string
    output?: string
  }
}

/**
 * Finds all tool callIDs across all messages.
 * Returns a map of callID → array of {messageIndex, partIndex}.
 */
export function buildToolCallMap(
  messages: MessageWithParts[],
): Map<string, Array<{ messageIndex: number; partIndex: number }>> {
  const callMap = new Map<string, Array<{ messageIndex: number; partIndex: number }>>()

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    for (let pi = 0; pi < msg.parts.length; pi++) {
      const part = msg.parts[pi] as ToolPartShape
      if (part.type !== "tool" || !part.callID) {
        continue
      }

      const existing = callMap.get(part.callID)
      if (existing) {
        existing.push({ messageIndex: mi, partIndex: pi })
      } else {
        callMap.set(part.callID, [{ messageIndex: mi, partIndex: pi }])
      }
    }
  }

  return callMap
}

/**
 * Given a set of message indices being compressed, ensures that if one half
 * of a tool_use/tool_result pair is compressed, the other half is too.
 *
 * Returns the expanded set of message indices that must be compressed together.
 */
export function enforceToolPairAtomic(
  compressIndices: Set<number>,
  toolCallMap: Map<string, Array<{ messageIndex: number; partIndex: number }>>,
): Set<number> {
  const expanded = new Set(compressIndices)

  for (const [, locations] of toolCallMap) {
    if (locations.length < 2) {
      continue
    }

    const anyCompressed = locations.some((loc) => expanded.has(loc.messageIndex))
    if (anyCompressed) {
      for (const loc of locations) {
        expanded.add(loc.messageIndex)
      }
    }
  }

  return expanded
}
