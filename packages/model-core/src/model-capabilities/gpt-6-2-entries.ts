import type { ModelCapabilitiesSnapshotEntry } from "./types"

// GPT-6.2 Astra and Sol (developers.openai.com/api/docs/models/gpt-6.2-astra, gpt-6.2-sol, 2026-11-17):
// 1,050,000 context, 922,000 max input, 128,000 max output, text and image input.
function gpt62Entry(id: string): ModelCapabilitiesSnapshotEntry {
  return {
    id,
    family: "gpt",
    reasoning: true,
    temperature: false,
    toolCall: true,
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
  }
}

export const GPT_6_2_MODEL_CAPABILITIES: Record<string, ModelCapabilitiesSnapshotEntry> = Object.fromEntries(
  ["gpt-6.2-astra", "gpt-6.2-astra-fast", "gpt-6.2-sol", "gpt-6.2-sol-fast"].map((id) => [id, gpt62Entry(id)]),
)
