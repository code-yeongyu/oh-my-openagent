import type { GcPart, MessageWithParts } from "../types"
import type { TierClassification } from "../tier-classifier"
import type { CompressStats } from "../message-compressor"
import { isAlreadyCompressedAt, setCompressionTier } from "../compression-cache"
import { getBrainId } from "../brain-id-store"
import { estimatePartsTokens } from "../tier-classifier"
import { compressToolOutput } from "./tool-output"
import { computeAssistantModifications } from "./assistant-response"
import { computeSystemModifications } from "./system-message"

type ToolPartShape = {
  type: string
  tool?: string
  callID?: string
  state?: { status?: string; output?: string }
}

type TextPartShape = {
  type: string
  text?: string
}

export function applyMessageCompression(
  messages: MessageWithParts[],
  classifications: TierClassification[],
  tokensToFree: number,
  stats: CompressStats,
): void {
  let budgetRemaining = tokensToFree

  for (const classification of classifications) {
    if (classification.tier === "hot") continue
    if (budgetRemaining <= 0 && classification.tier !== "gone") continue
    if (classification.tier === "gone") continue

    const msg = messages[classification.messageIndex]
    const info = msg.info
    const sessionID = info.sessionID ?? ""
    const messageID = info.id ?? ""

    if (sessionID && messageID && (classification.tier === "warm" || classification.tier === "cold")) {
      if (isAlreadyCompressedAt(sessionID, messageID, classification.tier)) continue
    }

    const tokensBefore = estimatePartsTokens(msg.parts)
    const role = info.role ?? "unknown"
    const brainId = messageID ? getBrainId(sessionID, messageID) : null

    if (role === "assistant") {
      compressAssistantMessage(msg, classification, brainId, stats)
    } else if (role === "user") {
      compressUserMessage(msg, classification, brainId, stats)
    }

    const tokensAfter = estimatePartsTokens(msg.parts)
    const tokensFreed = tokensBefore - tokensAfter
    budgetRemaining -= tokensFreed

    if (tokensFreed > 0 && sessionID && messageID && (classification.tier === "warm" || classification.tier === "cold")) {
      setCompressionTier(sessionID, messageID, classification.tier)
    }
  }
}

function compressAssistantMessage(
  msg: MessageWithParts,
  classification: TierClassification,
  brainId: number | null,
  stats: CompressStats,
): void {
  for (let pi = msg.parts.length - 1; pi >= 0; pi--) {
    const part = msg.parts[pi]
    const typed = part as GcPart as ToolPartShape

    if (typed.type === "tool" && typed.state?.output) {
      const result = compressToolOutput(
        typed.state.output,
        typed.tool ?? "unknown-tool",
        classification.tier,
        brainId,
      )
      if (result) {
        typed.state.output = result.compressed
        stats.toolOutputsCompressed++
      }
    }
  }

  const assistantMods = computeAssistantModifications(msg.parts, classification.tier, brainId)

  for (let i = assistantMods.length - 1; i >= 0; i--) {
    const mod = assistantMods[i]
    if (mod.action === "remove") {
      msg.parts.splice(mod.partIndex, 1)
      stats.thinkingBlocksRemoved++
    } else if (mod.action === "replace" && mod.newText !== undefined) {
      const textPart = msg.parts[mod.partIndex] as GcPart as TextPartShape
      textPart.text = mod.newText
      stats.textPartsCompressed++
    }
  }
}

function compressUserMessage(
  msg: MessageWithParts,
  classification: TierClassification,
  brainId: number | null,
  stats: CompressStats,
): void {
  for (let pi = msg.parts.length - 1; pi >= 0; pi--) {
    const part = msg.parts[pi]
    const typed = part as GcPart as ToolPartShape

    if (typed.type === "tool" && typed.state?.output) {
      const result = compressToolOutput(
        typed.state.output,
        typed.tool ?? "unknown-tool",
        classification.tier,
        brainId,
      )
      if (result) {
        typed.state.output = result.compressed
        stats.toolOutputsCompressed++
      }
    }
  }

  const systemMods = computeSystemModifications(msg.parts, classification.tier)

  for (let i = systemMods.length - 1; i >= 0; i--) {
    const mod = systemMods[i]
    if (mod.action === "remove") {
      msg.parts.splice(mod.partIndex, 1)
      stats.systemPartsRemoved++
    }
  }
}
