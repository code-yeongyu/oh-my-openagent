import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { BrowserAutomationProvider } from "../config/schema/browser-automation"
import type {
  LoadedSkill,
  SkillScope,
} from "../features/opencode-skill-loader/types"

import {
  discoverConfigSourceSkills,
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectAgentsSkills,
  discoverGlobalAgentsSkills,
  mergeSkills,
} from "../features/opencode-skill-loader"
import { createBuiltinSkills } from "../features/builtin-skills"
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader"

export type SkillContext = {
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
}

const PROVIDER_GATED_SKILL_NAMES = new Set(["agent-browser", "playwright"])

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user"
  if (scope === "project" || scope === "opencode-project") return "project"
  return "plugin"
}

function filterProviderGatedSkills(
  skills: LoadedSkill[],
  browserProvider: BrowserAutomationProvider,
): LoadedSkill[] {
  return skills.filter((skill) => {
    if (!PROVIDER_GATED_SKILL_NAMES.has(skill.name)) {
      return true
    }

    return skill.name === browserProvider
  })
}

export async function createSkillContext(args: {
  directory: string
  pluginConfig: OhMyOpenCodeConfig
}): Promise<SkillContext> {
  const { directory, pluginConfig } = args

  const browserProvider: BrowserAutomationProvider =
    pluginConfig.browser_automation_engine?.provider ?? "playwright"

  const disabledSkills = new Set<string>(pluginConfig.disabled_skills ?? [])
  const systemMcpNames = getSystemMcpServerNames()

  const builtinSkills = createBuiltinSkills({
    browserProvider,
    disabledSkills,
  }).filter((skill) => {
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false
      }
    }
    return true
  })

  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false
  const [configSourceSkills, userSkills, globalSkills, projectSkills, opencodeProjectSkills, agentsProjectSkills, agentsGlobalSkills] =
    await Promise.all([
      discoverConfigSourceSkills({
        config: pluginConfig.skills,
        configDir: directory,
      }),
      includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
      discoverOpencodeGlobalSkills(),
      includeClaudeSkills ? discoverProjectClaudeSkills(directory) : Promise.resolve([]),
      discoverOpencodeProjectSkills(directory),
      discoverProjectAgentsSkills(directory),
      discoverGlobalAgentsSkills(),
    ])

  const filteredConfigSourceSkills = filterProviderGatedSkills(
    configSourceSkills,
    browserProvider,
  )
  const filteredUserSkills = filterProviderGatedSkills(userSkills, browserProvider)
  const filteredGlobalSkills = filterProviderGatedSkills(globalSkills, browserProvider)
  const filteredProjectSkills = filterProviderGatedSkills(projectSkills, browserProvider)
  const filteredOpencodeProjectSkills = filterProviderGatedSkills(
    opencodeProjectSkills,
    browserProvider,
  )
  const filteredAgentsProjectSkills = filterProviderGatedSkills(
    agentsProjectSkills,
    browserProvider,
  )
  const filteredAgentsGlobalSkills = filterProviderGatedSkills(
    agentsGlobalSkills,
    browserProvider,
  )

  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    filteredConfigSourceSkills,
    [...filteredUserSkills, ...filteredAgentsGlobalSkills],
    filteredGlobalSkills,
    [...filteredProjectSkills, ...filteredAgentsProjectSkills],
    filteredOpencodeProjectSkills,
    { configDir: directory },
  )

  const availableSkills: AvailableSkill[] = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? "",
    location: mapScopeToLocation(skill.scope),
  }))

  return {
    mergedSkills,
    availableSkills,
    browserProvider,
    disabledSkills,
  }
}
