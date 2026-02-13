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
    model: "anthropic/claude-sonnet-4-5",
    name: "Claude",
  },
  {
    provider: (a) => a.native.openai,
    model: "openai/gpt-5.2",
    name: "GPT",
  },
  {
    provider: (a) => a.native.gemini,
    model: "google/gemini-3-flash",
    name: "Gemini",
  },
  {
    provider: (a) => a.copilot,
    model: "github-copilot/gpt-5.2",
    name: "Copilot GPT",
  },
  {
    provider: (a) => a.opencodeZen,
    model: "opencode/claude-sonnet-4-5",
    name: "OpenCode Claude",
  },
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
