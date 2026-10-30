import { loadFactsPersona, serializeFactsPayload, type FactsPayload } from "@oh-my-opencode/memory-core"

import { FACTS_RECORD_TOOL_NAME, factsRecordContract } from "./facts-record-tool"

// A bounded exception for one indivisible entry; ordinary batching stays at 128 KiB.
export const FACTS_OVERSIZED_BYTES = 512 * 1024
export const FACTS_OUTPUT_TOKENS = 4096
export const FACTS_REQUEST_LIMIT = 8
export const FACTS_RECORD_BYTES = 128 * 1024
export const FACTS_RECORD_LIMIT = 256
const CONTEXT_FRAMING_RESERVE = 8192

export type FactsModelCapacity = { readonly contextWindow: number; readonly maxTokens: number }

export function factsPrompt(payloadText: string): string {
  return `Extract durable facts from this payload and record each accepted fact with ${FACTS_RECORD_TOOL_NAME}.\n\n${payloadText}`
}

export function factsContextFits(context: unknown, model: FactsModelCapacity): boolean {
  return Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0
    && Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0
    // UTF-8 bytes conservatively overestimate text tokens, including escaped JSON and tool schemas.
    && Buffer.byteLength(JSON.stringify(context), "utf8") + Math.min(FACTS_OUTPUT_TOKENS, model.maxTokens)
      + CONTEXT_FRAMING_RESERVE <= model.contextWindow
}

export function admitOversizedFacts(payload: FactsPayload, model: unknown): boolean {
  if (payload.entries.length !== 1 || model === null || typeof model !== "object"
    || !("contextWindow" in model) || typeof model.contextWindow !== "number"
    || !("maxTokens" in model) || typeof model.maxTokens !== "number") return false
  const text = serializeFactsPayload(payload)
  return Buffer.byteLength(text, "utf8") <= FACTS_OVERSIZED_BYTES && factsContextFits({
    systemPrompt: loadFactsPersona(),
    messages: [{ role: "user", content: [{ type: "text", text: factsPrompt(text) }] }],
    tools: [factsRecordContract],
  }, { contextWindow: model.contextWindow, maxTokens: model.maxTokens })
}
