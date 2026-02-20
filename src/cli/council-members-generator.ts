import type { ProviderAvailability } from "./model-fallback-types"

export interface CouncilMember {
  model: string
  name: string
}

const COUNCIL_CANDIDATES: Array<{
  provider: (avail: ProviderAvailability) => boolean
  model: string
  name: string
}> = [
  {
    provider: (a) => a.native.claude,
    model: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
  },
  {
    provider: (a) => a.native.openai,
    model: "openai/gpt-5.3-codex",
    name: "GPT 5.3 Codex",
  },
  {
    provider: (a) => a.native.gemini,
    model: "google/gemini-3-pro-preview",
    name: "Gemini Pro 3",
  },
  {
    provider: (a) => a.kimiForCoding,
    model: "kimi-for-coding/kimi-k2.5",
    name: "Kimi 2.5",
  }
]

export function generateCouncilMembers(avail: ProviderAvailability): CouncilMember[] {
  const members: CouncilMember[] = []

  for (const candidate of COUNCIL_CANDIDATES) {
    if (candidate.provider(avail)) {
      members.push({ model: candidate.model, name: candidate.name })
    }
  }

  if (members.length < 2) {
    return []
  }

  return members
}
