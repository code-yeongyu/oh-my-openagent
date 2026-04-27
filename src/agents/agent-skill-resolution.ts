import type { AgentConfig } from "@opencode-ai/sdk"
import type { BrowserAutomationProvider, GitMasterConfig } from "../config/schema"
import { resolveMultipleSkills } from "../features/opencode-skill-loader/skill-content"

type AgentConfigWithSkills = AgentConfig & { skills?: string[] }

export function resolveAgentSkills(
  config: AgentConfig,
  options: {
    gitMasterConfig?: GitMasterConfig
    browserProvider?: BrowserAutomationProvider
    disabledSkills?: Set<string>
  } = {}
): AgentConfig {
  const { skills, ...configWithoutSkills } = config as AgentConfigWithSkills
  if (!skills?.length) return configWithoutSkills

  const { resolved } = resolveMultipleSkills(skills, options)
  if (resolved.size === 0) return configWithoutSkills

  const skillContent = Array.from(resolved.values()).join("\n\n")
  return {
    ...configWithoutSkills,
    prompt: skillContent + (configWithoutSkills.prompt ? "\n\n" + configWithoutSkills.prompt : ""),
  }
}
