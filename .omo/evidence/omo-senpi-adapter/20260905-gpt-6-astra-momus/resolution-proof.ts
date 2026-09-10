import { AGENT_MODEL_REQUIREMENTS } from "../../../../packages/model-core/src/agent-model-requirements.ts"
import { resolveModelWithFallback } from "../../../../packages/model-core/src/model-resolver.ts"
import { AGENT_FALLBACK_CHAINS } from "../../../../packages/senpi-task/src/agents/builtin/fallback-chains.ts"

const momus = AGENT_MODEL_REQUIREMENTS.momus

const cases = [
  { label: "native Astra available", availableModels: new Set(["openai-codex/gpt-6-astra"]) },
  { label: "Copilot-only Astra", availableModels: new Set(["github-copilot/gpt-6-astra"]) },
  { label: "native + Copilot Astra", availableModels: new Set(["openai-codex/gpt-6-astra", "github-copilot/gpt-6-astra"]) },
  { label: "opencode-only Astra", availableModels: new Set(["opencode/gpt-6-astra"]) },
  { label: "no Astra, Opus available", availableModels: new Set(["github-copilot/gpt-5.6-sol", "anthropic/claude-opus-5"]) },
]

for (const { label, availableModels } of cases) {
  const resolved = resolveModelWithFallback({
    fallbackChain: momus.fallbackChain,
    availableModels,
    systemDefaultModel: "system/default",
  })
  console.log(JSON.stringify({ label, resolved }))
}

// The senpi-task transcription is an independent hand mirror; prove the two agree entry for entry.
console.log(
  JSON.stringify({
    label: "senpi-task transcription matches model-core",
    matches: JSON.stringify(AGENT_FALLBACK_CHAINS.momus) === JSON.stringify(momus.fallbackChain),
    modelCore: momus.fallbackChain,
    senpiTask: AGENT_FALLBACK_CHAINS.momus,
  }),
)
