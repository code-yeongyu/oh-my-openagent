import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides } from "./types"
import { sisyphusAgent } from "./sisyphus"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"
import { deepMerge } from "../shared"

const allBuiltinAgents: Record<BuiltinAgentName, AgentConfig> = {
  Sisyphus: sisyphusAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
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
  return deepMerge(base, override as Partial<AgentConfig>)
}

export function createBuiltinAgents(
  disabledAgents: BuiltinAgentName[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinAgents)) {
    const agentName = name as BuiltinAgentName

    if (disabledAgents.includes(agentName)) {
      continue
    }

    let finalConfig = config

    if ((agentName === "Sisyphus" || agentName === "librarian") && directory && config.prompt) {
      const envContext = createEnvContext(directory)
      finalConfig = {
        ...config,
        prompt: config.prompt + envContext,
      }
    }

    const override = agentOverrides[agentName]

    if (agentName === "Sisyphus" && systemDefaultModel && !override?.model) {
      finalConfig = {
        ...finalConfig,
        model: systemDefaultModel,
      }
    }

    if (override) {
      result[name] = mergeAgentConfig(finalConfig, override)
    } else {
      result[name] = finalConfig
    }
  }

  return result
}
