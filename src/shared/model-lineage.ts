import type { FallbackEntry } from "./model-requirements"
import modelCapabilities from "../generated/model-capabilities.generated.json" with { type: "json" }

export type ModelLineage = string

type ModelCapabilityEntry = {
  id?: string
  family?: string
}

const MODEL_FAMILY_INDEX: Record<string, string | undefined> = (() => {
  const capabilities = modelCapabilities as { models: Record<string, ModelCapabilityEntry> }
  const index: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(capabilities.models ?? {})) {
    index[key.toLowerCase()] = value.family
    if (value.id) index[value.id.toLowerCase()] = value.family
  }
  return index
})()

const PREFIX_LINEAGE_RULES: ReadonlyArray<{ prefix: string; lineage: ModelLineage }> = [
  { prefix: "claude-opus", lineage: "claude-opus" },
  { prefix: "claude-sonnet", lineage: "claude-sonnet" },
  { prefix: "claude-haiku", lineage: "claude-haiku" },
  { prefix: "gpt-", lineage: "gpt" },
  { prefix: "o1", lineage: "gpt" },
  { prefix: "o3", lineage: "gpt" },
  { prefix: "gemini-", lineage: "gemini-flash" },
  { prefix: "kimi-", lineage: "kimi" },
  { prefix: "k2", lineage: "kimi" },
  { prefix: "glm-", lineage: "glm" },
  { prefix: "deepseek-", lineage: "deepseek" },
  { prefix: "qwen", lineage: "qwen" },
  { prefix: "minimax", lineage: "minimax" },
  { prefix: "mistral", lineage: "mistral" },
  { prefix: "grok-", lineage: "grok" },
]

const LINEAGE_GROUPS: ReadonlyArray<ReadonlySet<ModelLineage>> = [
  new Set(["claude-opus", "claude-sonnet", "claude-haiku"]),
  new Set(["gpt"]),
  new Set(["gemini-flash", "gemini-flash-lite", "gemini-pro"]),
  new Set(["kimi"]),
  new Set(["glm"]),
  new Set(["deepseek"]),
  new Set(["qwen"]),
  new Set(["minimax"]),
  new Set(["mistral"]),
  new Set(["grok"]),
]

export function getModelLineage(modelId: string | undefined): ModelLineage | undefined {
  if (!modelId) return undefined
  const normalized = modelId.toLowerCase()
  const fromIndex = MODEL_FAMILY_INDEX[normalized]
  if (fromIndex) return fromIndex
  const providerless = normalized.includes("/") ? normalized.split("/").at(-1) ?? normalized : normalized
  for (const candidate of [normalized, providerless]) {
    for (const rule of PREFIX_LINEAGE_RULES) {
      if (candidate.startsWith(rule.prefix)) return rule.lineage
    }
  }
  return undefined
}

export function getCallerLineageGroup(modelId: string | undefined): Set<ModelLineage> {
  const lineage = getModelLineage(modelId)
  if (!lineage) return new Set()
  for (const group of LINEAGE_GROUPS) {
    if (group.has(lineage)) return new Set(group)
  }
  return new Set([lineage])
}

export type VoterCandidate = {
  lineage: ModelLineage
  entry: FallbackEntry
}

const DEFAULT_VOTER_POOL: ReadonlyArray<VoterCandidate> = [
  {
    lineage: "claude-opus",
    entry: {
      providers: ["anthropic", "github-copilot", "opencode", "vercel"],
      model: "claude-opus-4-7",
      variant: "max",
    },
  },
  {
    lineage: "gpt",
    entry: {
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
    },
  },
  {
    lineage: "gemini-flash",
    entry: {
      providers: ["google", "google-vertex", "github-copilot", "opencode", "vercel"],
      model: "gemini-3.1-pro",
      variant: "high",
    },
  },
  {
    lineage: "kimi",
    entry: {
      providers: ["opencode-go", "opencode", "vercel", "moonshotai", "kimi-for-coding"],
      model: "kimi-k2.6",
    },
  },
  {
    lineage: "glm",
    entry: {
      providers: ["opencode", "zai-coding-plan", "vercel"],
      model: "glm-5",
    },
  },
]

export function getDefaultVoterPool(): ReadonlyArray<VoterCandidate> {
  return DEFAULT_VOTER_POOL
}

export type PickVotersOptions = {
  callerModel?: string
  excludeLineages?: ReadonlyArray<ModelLineage>
  count?: number
  pool?: ReadonlyArray<VoterCandidate>
}

export function pickDiverseVoters(options: PickVotersOptions = {}): VoterCandidate[] {
  const count = options.count ?? 3
  const pool = options.pool ?? DEFAULT_VOTER_POOL
  const excluded = new Set<ModelLineage>(options.excludeLineages ?? [])
  for (const lineage of getCallerLineageGroup(options.callerModel)) excluded.add(lineage)

  const seen = new Set<ModelLineage>()
  const picked: VoterCandidate[] = []
  for (const candidate of pool) {
    if (excluded.has(candidate.lineage)) continue
    if (seen.has(candidate.lineage)) continue
    seen.add(candidate.lineage)
    picked.push(candidate)
    if (picked.length >= count) break
  }
  return picked
}
