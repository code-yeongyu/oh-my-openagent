import type { MessageWithParts } from "./types"
import type { Tier, TierClassification } from "./tier-classifier"
import { parseMarkers } from "./reference-marker"
import { getBrainId } from "./brain-id-store"

/**
 * Promote cold/gone messages to warm if they are referenced by hot messages.
 *
 * References detected:
 * 1. Brain ID markers — hot message text contains [brain#N] where N maps to an older message
 * 2. Tool callID pairs — hot message has tool callID that also appears in an older message
 */
export function applyRelevancePromotions(
  messages: MessageWithParts[],
  classifications: TierClassification[],
): void {
  const hotIndices = new Set<number>()
  for (const c of classifications) {
    if (c.tier === "hot") hotIndices.add(c.messageIndex)
  }

  if (hotIndices.size === 0) return

  const referencedIndices = new Set<number>()

  collectBrainIdReferences(messages, hotIndices, referencedIndices)
  collectToolCallReferences(messages, hotIndices, referencedIndices)

  for (const c of classifications) {
    if (referencedIndices.has(c.messageIndex) && isPromotable(c.tier)) {
      c.tier = "warm"
    }
  }
}

function isPromotable(tier: Tier): boolean {
  return tier === "cold" || tier === "gone"
}

function collectBrainIdReferences(
  messages: MessageWithParts[],
  hotIndices: Set<number>,
  referencedIndices: Set<number>,
): void {
  const brainIdToMessageIndex = buildBrainIdToMessageMap(messages)
  if (brainIdToMessageIndex.size === 0) return

  for (const idx of hotIndices) {
    const msg = messages[idx]
    for (const part of msg.parts) {
      const text = part.text ?? part.state?.output ?? ""
      if (!text) continue

      for (const marker of parseMarkers(text)) {
        const targetIdx = brainIdToMessageIndex.get(marker.brainId)
        if (targetIdx !== undefined && !hotIndices.has(targetIdx)) {
          referencedIndices.add(targetIdx)
        }
      }
    }
  }
}

function buildBrainIdToMessageMap(messages: MessageWithParts[]): Map<number, number> {
  const map = new Map<number, number>()
  for (let i = 0; i < messages.length; i++) {
    const info = messages[i].info
    if (!info.sessionID || !info.id) continue
    const brainId = getBrainId(info.sessionID, info.id)
    if (brainId !== null) {
      map.set(brainId, i)
    }
  }
  return map
}

function collectToolCallReferences(
  messages: MessageWithParts[],
  hotIndices: Set<number>,
  referencedIndices: Set<number>,
): void {
  const hotCallIDs = new Set<string>()
  for (const idx of hotIndices) {
    for (const part of messages[idx].parts) {
      if (part.type === "tool" && part.callID) {
        hotCallIDs.add(part.callID)
      }
    }
  }

  if (hotCallIDs.size === 0) return

  for (let i = 0; i < messages.length; i++) {
    if (hotIndices.has(i)) continue
    for (const part of messages[i].parts) {
      if (part.type === "tool" && part.callID && hotCallIDs.has(part.callID)) {
        referencedIndices.add(i)
      }
    }
  }
}
