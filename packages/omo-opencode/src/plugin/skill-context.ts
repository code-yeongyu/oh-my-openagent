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
  readOpencodeConfigSkills,
} from "../features/opencode-skill-loader"
import { createBuiltinSkills } from "../features/builtin-skills"
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader"
import { adaptHostSkillConfig } from "../shared/host-skill-config"

export type SkillContext = {
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
}

const PROVIDER_GATED_SKILL_NAMES = new Set(["agent-browser", "dev-browser", "playwright"])

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
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
  }).filter((skill) => {
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false
      }
    }
    return true
  })

  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false
  const hostSkillConfig = adaptHostSkillConfig(readOpencodeConfigSkills(directory))
  const [
    configSourceSkills,
    hostConfigSkills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills,
    agentsProjectSkills,
    agentsGlobalSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: pluginConfig.skills,
      configDir: directory,
    }),
    discoverConfigSourceSkills({
      config: hostSkillConfig,
      configDir: directory,
    }),
    includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    includeClaudeSkills ? discoverProjectClaudeSkills(directory) : Promise.resolve([]),
    discoverOpencodeProjectSkills(directory),
    discoverProjectAgentsSkills(directory),
    discoverGlobalAgentsSkills(),
  ])

  // Host-config skills (read from opencode.jsonc skills.paths) take precedence
  // over plugin-config skills when the same skill name is declared in both.
  // This matches `command-config-handler.ts` where host entries are spread
  // after plugin entries, and matches user expectation that opencode.jsonc is
  // the source of truth. Both source lists share the same `"config"` scope,
  // so `mergeSkills` cannot disambiguate them — we resolve the collision here
  // before passing the merged list downstream.
  const configSkillsHostWins = new Map<string, LoadedSkill>()
  for (const skill of configSourceSkills) configSkillsHostWins.set(skill.name, skill)
  for (const skill of hostConfigSkills) configSkillsHostWins.set(skill.name, skill)
  const filteredConfigSourceSkills = filterProviderGatedSkills(
    Array.from(configSkillsHostWins.values()),
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
