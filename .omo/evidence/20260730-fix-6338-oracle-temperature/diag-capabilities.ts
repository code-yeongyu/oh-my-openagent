// What does each model ID actually resolve to, and which layer decides temperature?
// Run against dev and against the fix to locate the true behavioral delta.
import { getModelCapabilities, resolveCompatibleModelSettings } from "../../../packages/omo-opencode/src/shared"

const ids: Array<[string, string]> = [
  ["azure-anthropic", "claude-opus-4-8"],
  ["azure-anthropic", "claude-opus-4-8-thinking"],
  ["anthropic", "claude-opus-4-8"],
  ["openai", "gpt-4o"],
]

for (const [providerID, modelID] of ids) {
  const capabilities = getModelCapabilities({ providerID, modelID })
  const resolved = resolveCompatibleModelSettings({
    providerID,
    modelID,
    desired: { temperature: 0.1, topP: 0.9 },
    capabilities,
  })
  console.log(`${providerID}/${modelID}`)
  console.log(`    capabilities=${JSON.stringify(capabilities)}`)
  console.log(`    resolved_has_temperature_key=${"temperature" in resolved} value=${JSON.stringify(resolved.temperature)}`)
}
