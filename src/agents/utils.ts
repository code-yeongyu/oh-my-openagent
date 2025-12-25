import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory } from "./types"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent } from "./oracle"
import { createLibrarianAgent } from "./librarian"
import { createExploreAgent } from "./explore"
import { createFrontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { createDocumentWriterAgent } from "./document-writer"
import { createMultimodalLookerAgent } from "./multimodal-looker"
import { deepMerge } from "../shared"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  Sisyphus: createSisyphusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "frontend-ui-ux-engineer": createFrontendUiUxEngineerAgent,
  "document-writer": createDocumentWriterAgent,
  "multimodal-looker": createMultimodalLookerAgent,
}

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

function buildAgent(source: AgentSource, model?: string): AgentConfig {
  return isFactory(source) ? source(model) : source
}

export function createEnvContext(directory: string): string {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = Intl.DateTimeFormat().resolvedOptions().locale

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })

  const platform = process.platform as "darwin" | "linux" | "win32" | string

  return `
Here is some useful information about the environment you are running in:
<env>
  Working directory: ${directory}
  Platform: ${platform}
  Today's date: ${dateStr} (NOT 2024, NEVEREVER 2024)
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</env>`
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const { prompt_append, ...rest } = override
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + prompt_append
  }

  return merged
}

export function createBuiltinAgents(
  disabledAgents: BuiltinAgentName[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (disabledAgents.includes(agentName)) {
      continue
    }

    const override = agentOverrides[agentName]
    const model = override?.model ?? (agentName === "Sisyphus" ? systemDefaultModel : undefined)

    let config = buildAgent(source, model)

    if ((agentName === "Sisyphus" || agentName === "librarian") && directory && config.prompt) {
      const envContext = createEnvContext(directory)
      config = { ...config, prompt: config.prompt + envContext }
    }

    if (override) {
      config = mergeAgentConfig(config, override)
    }

    result[name] = config
  }

  return result
}
