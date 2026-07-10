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
  discoverSharedSkills,
  createSharedCanonicalAliases,
  collectDisabledSkillAliases,
  isDisabledSkillAlias,
  mergeSkills,
  normalizeSkillAliasName,
  readOpencodeConfigSkills,
} from "../features/opencode-skill-loader"
import { resolveActiveBuiltinSkills } from "../features/builtin-skills"
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader"
import { adaptHostSkillConfig } from "../shared/host-skill-config"

export type SkillContext = {
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
}

export { collectDisabledSkillAliases }

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

function filterDisabledSkills(
  skills: LoadedSkill[],
  disabledSkills: ReadonlySet<string>,
): LoadedSkill[] {
  if (disabledSkills.size === 0) return skills

  return skills.filter((skill) => !isDisabledSkillAlias(skill, disabledSkills))
}

function filterProtectedSharedAliasCollisions(
  skills: LoadedSkill[],
  protectedSharedAliasNames: ReadonlySet<string>,
): LoadedSkill[] {
  if (protectedSharedAliasNames.size === 0) return skills

  return skills.filter((skill) => {
    if (skill.scope === "shared") return true
    return !protectedSharedAliasNames.has(normalizeSkillAliasName(skill.name))
  })
}

function isDisabledConfigSkillEntryName(
  name: string,
  disabledSkills: ReadonlySet<string>,
): boolean {
  return disabledSkills.has(normalizeSkillAliasName(name))
}

export async function createSkillContext(args: {
  directory: string
  pluginConfig: OhMyOpenCodeConfig
  /**
   * Host skill config from opencode's merged runtime config (e.g. fetched via
   * the plugin client). Includes runtime-injected `skills.paths` from other
   * plugins. When omitted, falls back to reading the on-disk opencode config.
   */
  hostSkills?: { paths?: string[]; urls?: string[] }
}): Promise<SkillContext> {
  const { directory, pluginConfig, hostSkills } = args

  const browserProvider: BrowserAutomationProvider =
    pluginConfig.browser_automation_engine?.provider ?? "playwright"
  const playwrightMcpArgs = pluginConfig.browser_automation_engine?.playwright_mcp_args

  const disabledSkills = collectDisabledSkillAliases(pluginConfig)

  const builtinSkills = resolveActiveBuiltinSkills({
    browserProvider,
    disabledSkills,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    playwrightMcpArgs,
    systemMcpNames: getSystemMcpServerNames(),
  })

  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false
  const hostSkillConfig = adaptHostSkillConfig(hostSkills ?? readOpencodeConfigSkills(directory))
  const [
    configSourceSkills,
    hostConfigSkills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills,
    agentsProjectSkills,
    agentsGlobalSkills,
    sharedSkills,
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
    discoverSharedSkills(),
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
  const activeConfigSourceSkills = filterDisabledSkills(filteredConfigSourceSkills, disabledSkills)
  const activeUserSkills = filterDisabledSkills(filteredUserSkills, disabledSkills)
  const activeGlobalSkills = filterDisabledSkills(filteredGlobalSkills, disabledSkills)
  const activeProjectSkills = filterDisabledSkills(filteredProjectSkills, disabledSkills)
  const activeOpencodeProjectSkills = filterDisabledSkills(
    filteredOpencodeProjectSkills,
    disabledSkills,
  )
  const activeAgentsProjectSkills = filterDisabledSkills(
    filteredAgentsProjectSkills,
    disabledSkills,
  )
  const activeAgentsGlobalSkills = filterDisabledSkills(
    filteredAgentsGlobalSkills,
    disabledSkills,
  )
  const sharedSkillAliases = createSharedCanonicalAliases(sharedSkills)
  const protectedSharedAliasNames = new Set(
    sharedSkillAliases.map((skill) => normalizeSkillAliasName(skill.name)),
  )
  const filteredSharedSkills = filterDisabledSkills(
    filterProviderGatedSkills(sharedSkills, browserProvider),
    disabledSkills,
  )
  const filteredSharedSkillAliases = filterDisabledSkills(
    filterProviderGatedSkills(sharedSkillAliases, browserProvider),
    disabledSkills,
  )
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    filterProtectedSharedAliasCollisions(activeConfigSourceSkills, protectedSharedAliasNames),
    [
      ...filterProtectedSharedAliasCollisions(
        [...activeUserSkills, ...activeAgentsGlobalSkills],
        protectedSharedAliasNames,
      ),
      ...filteredSharedSkillAliases,
      ...filteredSharedSkills,
    ],
    filterProtectedSharedAliasCollisions(activeGlobalSkills, protectedSharedAliasNames),
    filterProtectedSharedAliasCollisions(
      [...activeProjectSkills, ...activeAgentsProjectSkills],
      protectedSharedAliasNames,
    ),
    filterProtectedSharedAliasCollisions(activeOpencodeProjectSkills, protectedSharedAliasNames),
    {
      configDir: directory,
      isConfigEntryAllowed: (name) =>
        !protectedSharedAliasNames.has(normalizeSkillAliasName(name)) &&
        !isDisabledConfigSkillEntryName(name, disabledSkills),
    },
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
