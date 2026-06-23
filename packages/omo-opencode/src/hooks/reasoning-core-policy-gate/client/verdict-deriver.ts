import type { PolicyVerdict } from "../types"
import { isRecord } from "./mcp-payload-extractor"

export function deriveVerdict(toolPayload: unknown, theory: Record<string, unknown>): PolicyVerdict {
  if (!isRecord(toolPayload)) {
    return deny("reasoning-core returned an invalid payload", { theory, result: toolPayload })
  }

  const conclusions = extractConclusions(toolPayload)
  const allowAccepted = conclusions?.["allow_action(current)"]?.status === "Accepted"
  const denyAccepted = conclusions?.["deny_action(current)"]?.status === "Accepted"

  if (denyAccepted) {
    return deny("reasoning-core rejected the action", {
      theory,
      result: toolPayload,
      matched: "deny_action(current)",
    })
  }

  if (allowAccepted) {
    return allow({
      theory,
      result: toolPayload,
      matched: "allow_action(current)",
    })
  }

  return deny("reasoning-core returned no accepted allow_action(current)", {
    theory,
    result: toolPayload,
  })
}

function extractConclusions(
  payload: Record<string, unknown>,
): Record<string, { status?: string }> | undefined {
  const structured = isRecord(payload.structuredContent) ? payload.structuredContent : payload
  const conclusions = isRecord(structured.conclusions) ? structured.conclusions : undefined
  if (conclusions) return conclusions as Record<string, { status?: string }>

  const result = isRecord(payload.result) ? payload.result : undefined
  return result && isRecord(result.conclusions)
    ? (result.conclusions as Record<string, { status?: string }>)
    : undefined
}

export function allow(proofArtifact: unknown): PolicyVerdict {
  return { allow: true, proofArtifact }
}

export function deny(reason: string, proofArtifact?: unknown): PolicyVerdict {
  return { allow: false, reason, proofArtifact }
}
