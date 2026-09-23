import type { BuildSystemContentInput } from "./types"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { isRecord } from "@oh-my-opencode/utils"
import { buildPlanAgentSystemPrepend, isPlanAgent } from "./constants"
import { buildSystemContentWithTokenLimit } from "./token-limiter"

const FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT = 24000
const PLAN_AGENT_PROMPT_BASE = `

Additional requirements for this planning request:
- Answer in English.
- Write the plan in English.
- Plan well for ultrawork execution.
- Include a clear atomic commit strategy.`

const TDD_LINE = "- Use TDD-oriented planning."

function buildPlanAgentPromptAppend(tddEnabled: boolean): string {
  if (tddEnabled) {
    return `${PLAN_AGENT_PROMPT_BASE}
${TDD_LINE}`
  }
  return PLAN_AGENT_PROMPT_BASE
}

function mergeNativeIntoAvailable(
  skills: AvailableSkill[],
  nativeSkillInfos: { name: string; description: string; location: string }[] | undefined,
): AvailableSkill[] {
  if (!nativeSkillInfos || nativeSkillInfos.length === 0) return skills
  const knownNames = new Set(skills.map((s) => s.name))
  const merged = [...skills]
  for (const native of nativeSkillInfos) {
    if (knownNames.has(native.name)) continue
    merged.push({ name: native.name, description: native.description, location: "user" })
    knownNames.add(native.name)
  }
  return merged
}

function usesFreeOrLocalModel(
  model: { providerID: string; modelID: string; variant?: string } | undefined,
  providerBaseURL?: string,
): boolean {
  if (!model) {
    return false
  }

  const provider = model.providerID.toLowerCase()
  const modelId = model.modelID.toLowerCase()
  return provider.includes("local")
    || provider === "ollama"
    || provider === "lmstudio"
    || modelId.includes("free")
    || isLocalBaseUrl(providerBaseURL)
}

function ipv4InCidr(firstOctet: number, secondOctet: number, base: number, prefixBits: number): boolean {
  const addr = (firstOctet << 8) | secondOctet
  const mask = 0xffff << (16 - prefixBits)
  return (addr & mask) === ((base & mask) & 0xffff)
}

/**
 * True when a URL points at loopback or a private/LAN address, so any
 * OpenAI-compatible endpoint hosted there is treated as a local model.
 * Conservative by design: unparseable input returns false so cloud models
 * are never capped by accident.
 */
export function isLocalBaseUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  let hostname = url.hostname.toLowerCase()
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1)
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true
  }

  if (hostname === "::1" || hostname === "::") {
    return true
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number)
    if (octets.some((octet) => octet > 255)) {
      return false
    }
    const [a, b] = [octets[0], octets[1]]
    return a === 127
      || a === 10
      || (a === 172 && ipv4InCidr(a, b, (172 << 8) | 16, 12))
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
  }

  const v6 = hostname.split(":").filter((part) => part.length > 0)
  if (v6.length > 0 && hostname.includes(":")) {
    const firstGroup = parseInt(v6[0].slice(0, 4), 16)
    if (!Number.isNaN(firstGroup)) {
      const topBits = firstGroup >> 8
      if (topBits === 0xfc || topBits === 0xfd || topBits === 0xfe && (firstGroup & 0xc0) === 0x80) {
        return true
      }
    }
  }

  return false
}

function readStringOption(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) {
    return undefined
  }
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Resolve the configured endpoint for a provider from opencode's merged
 * runtime config (`client.config.get()`): model-level `options.baseURL`
 * overrides the provider-level `options.baseURL`. Returns undefined when the
 * config carries no usable baseURL for the provider.
 */
export function resolveProviderBaseURL(configData: unknown, providerID?: string, modelID?: string): string | undefined {
  if (!providerID || !isRecord(configData)) {
    return undefined
  }

  const data = isRecord(configData.data) ? configData.data : configData
  const providers = isRecord(data.provider) ? data.provider : undefined
  const providerEntry = isRecord(providers?.[providerID]) ? providers?.[providerID] : undefined
  if (!providerEntry) {
    return undefined
  }

  if (modelID) {
    const models = isRecord(providerEntry.models) ? providerEntry.models : undefined
    const modelEntry = isRecord(models?.[modelID]) ? models?.[modelID] : undefined
    const modelBaseURL = readStringOption(modelEntry?.options, "baseURL")
    if (modelBaseURL) {
      return modelBaseURL
    }
  }

  return readStringOption(providerEntry.options, "baseURL")
}

/**
 * Build the system content to inject into the agent prompt.
 * Combines skill content, category prompt append, and plan agent system prepend.
 */
export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const {
    skillContent,
    skillContents,
    categoryPromptAppend,
    agentsContext,
    maxPromptTokens,
    model,
    providerBaseURL,
    agentName,
    availableCategories,
    availableSkills,
    nativeSkillInfos,
  } = input

  const effectiveAvailableSkills = mergeNativeIntoAvailable(availableSkills ?? [], nativeSkillInfos)

  const isPlan = isPlanAgent(agentName)
  const planAgentPrepend = isPlan
    ? buildPlanAgentSystemPrepend(availableCategories, effectiveAvailableSkills)
    : ""

  const effectiveAgentsContext = agentsContext ?? planAgentPrepend

  const effectiveMaxPromptTokens = maxPromptTokens
    ?? (usesFreeOrLocalModel(model, providerBaseURL) ? FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT : undefined)

  return buildSystemContentWithTokenLimit(
    {
      skillContent,
      skillContents,
      categoryPromptAppend,
      agentsContext: effectiveAgentsContext,
      planAgentPrepend,
    },
    effectiveMaxPromptTokens
  )
}

export function buildTaskPrompt(prompt: string, agentName: string | undefined, tddEnabled?: boolean): string {
  if (!isPlanAgent(agentName)) {
    return prompt
  }

  const effectiveTdd = tddEnabled ?? true
  return `${prompt}${buildPlanAgentPromptAppend(effectiveTdd)}`
}
