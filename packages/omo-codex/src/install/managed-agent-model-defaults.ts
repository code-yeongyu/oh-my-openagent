import type { AgentModelReceipt } from "./agent-model-overrides"

// Installs made before the model receipt existed carry no record of what LazyCodex wrote, so every
// model a bundled agent TOML ever shipped counts as ours; anything else is the user's choice.
const PREVIOUSLY_BUNDLED_AGENT_MODELS: ReadonlySet<string> = new Set([
  "gpt-5.2",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-luna-fast",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
])

export function handEditedAgentModel(installedModel: string | null, receipt: AgentModelReceipt | undefined): string | null {
  if (installedModel === null) return null
  if (receipt?.model !== undefined) return installedModel === receipt.model ? null : installedModel
  return PREVIOUSLY_BUNDLED_AGENT_MODELS.has(installedModel) ? null : installedModel
}
