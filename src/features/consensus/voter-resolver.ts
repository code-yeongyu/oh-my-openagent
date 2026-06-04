import type { VoterCandidate } from "../../shared/model-lineage"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { log } from "../../shared"
import type { ResolvedVoterCandidate } from "./types"

const LINEAGE_FALLBACK_MODELS: Record<string, ReadonlyArray<string>> = {
  "gemini-flash": ["gemini-3.1-pro", "gemini-3-pro-preview", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-2.5-flash"],
  "claude-opus": ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"],
  gpt: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  kimi: ["kimi-k2.6", "kimi-k2.5", "k2p5"],
  glm: ["glm-5", "glm-4.6"],
}

export function resolveVoterCandidate(
  candidate: VoterCandidate,
  connectedProviders: ReadonlySet<string>,
  availableModels: Set<string>,
): ResolvedVoterCandidate | null {
  const candidateProviders = candidate.entry.providers.filter((p: string) => connectedProviders.has(p))
  if (candidateProviders.length === 0) {
    log(`[consensus] no connected provider for lineage=${candidate.lineage}; providers=${candidate.entry.providers.join(",")}`)
    return null
  }

  const modelsToTry = [candidate.entry.model, ...(LINEAGE_FALLBACK_MODELS[candidate.lineage] ?? [])]
  const seen = new Set<string>()
  const uniqueModels = modelsToTry.filter(m => (seen.has(m) ? false : (seen.add(m), true)))

  if (availableModels.size > 0) {
    for (const provider of candidateProviders) {
      for (const model of uniqueModels) {
        const matched = fuzzyMatchModel(model, availableModels, [provider])
        if (matched) {
          const modelID = matched.split("/").slice(1).join("/")
          log(`[consensus] resolved lineage=${candidate.lineage} -> ${provider}/${modelID}`)
          return { lineage: candidate.lineage, providerID: provider, modelID, variant: candidate.entry.variant }
        }
      }
    }

    const staleProvider = candidateProviders.find((p: string) => !providerHasInventory(p, availableModels))
    if (staleProvider) {
      const modelID = transformModelForProvider(staleProvider, candidate.entry.model)
      log(`[consensus] inventory for provider=${staleProvider} unknown (stale cache); provider-level resolve lineage=${candidate.lineage} -> ${staleProvider}/${modelID}`)
      return { lineage: candidate.lineage, providerID: staleProvider, modelID, variant: candidate.entry.variant }
    }

    log(`[consensus] no model match for lineage=${candidate.lineage}; connected providers have inventory but not this model`)
    return null
  }

  const provider = candidateProviders[0]
  const modelID = transformModelForProvider(provider, candidate.entry.model)
  log(`[consensus] model inventory empty; provider-level resolve lineage=${candidate.lineage} -> ${provider}/${modelID}`)
  return { lineage: candidate.lineage, providerID: provider, modelID, variant: candidate.entry.variant }
}

function providerHasInventory(provider: string, availableModels: Set<string>): boolean {
  const prefix = `${provider}/`
  for (const m of availableModels) {
    if (m.startsWith(prefix)) return true
  }
  return false
}
