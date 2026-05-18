import { join } from "path"
import { homedir } from "os"
import { getClaudeConfigDir } from "../../shared/claude-config-dir"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { getOpenCodeSkillDirs } from "../../shared/opencode-command-dirs"
import {
  findProjectAgentsSkillDirs,
  findProjectClaudeSkillDirs,
  findProjectOpencodeSkillDirs,
} from "../../shared/project-discovery-dirs"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { LoadedSkill } from "./types"
import { skillsToCommandDefinitionRecord } from "./skill-definition-record"
import { deduplicateSkillsByName } from "./skill-deduplication"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { readOpenCodeSkillsPaths } from "./opencode-config-skills-paths"

export async function loadUserSkills(): Promise<Record<string, CommandDefinition>> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  const skills = await loadSkillsFromDir({ skillsDir: userSkillsDir, scope: "user" })
  return skillsToCommandDefinitionRecord(skills)
}

export async function loadProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const projectSkillDirs = findProjectClaudeSkillDirs(directory ?? process.cwd())
  const allSkills = await Promise.all(
    projectSkillDirs.map((skillsDir) => loadSkillsFromDir({ skillsDir, scope: "project" })),
  )
  return skillsToCommandDefinitionRecord(deduplicateSkillsByName(allSkills.flat()))
}

export async function loadOpencodeGlobalSkills(): Promise<Record<string, CommandDefinition>> {
  const skillDirs = getOpenCodeSkillDirs({ binary: "opencode" })
  const allSkills = await Promise.all(
    skillDirs.map(skillsDir => loadSkillsFromDir({ skillsDir, scope: "opencode" }))
  )
  return skillsToCommandDefinitionRecord(deduplicateSkillsByName(allSkills.flat()))
}

export async function loadOpencodeProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const opencodeProjectSkillDirs = findProjectOpencodeSkillDirs(
    directory ?? process.cwd(),
  )
  const allSkills = await Promise.all(
    opencodeProjectSkillDirs.map((skillsDir) =>
      loadSkillsFromDir({ skillsDir, scope: "opencode-project" }),
    ),
  )
  return skillsToCommandDefinitionRecord(deduplicateSkillsByName(allSkills.flat()))
}

export async function loadProjectAgentsSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const agentsProjectSkillDirs = findProjectAgentsSkillDirs(directory ?? process.cwd())
  const allSkills = await Promise.all(
    agentsProjectSkillDirs.map((skillsDir) => loadSkillsFromDir({ skillsDir, scope: "project" })),
  )
  return skillsToCommandDefinitionRecord(deduplicateSkillsByName(allSkills.flat()))
}

export async function loadGlobalAgentsSkills(homeDirectory: string = homedir()): Promise<Record<string, CommandDefinition>> {
  const agentsGlobalDir = join(homeDirectory, ".agents", "skills")
  const skills = await loadSkillsFromDir({ skillsDir: agentsGlobalDir, scope: "user" })
  return skillsToCommandDefinitionRecord(skills)
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
  directory?: string
}

export async function discoverAllSkills(directory?: string): Promise<LoadedSkill[]> {
  const [opencodeProjectSkills, opencodeGlobalSkills, configPathsSkills, projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] =
    await Promise.all([
      discoverOpencodeProjectSkills(directory),
      discoverOpencodeGlobalSkills(),
      discoverConfigPathsSkills(directory),
      discoverProjectClaudeSkills(directory),
      discoverUserClaudeSkills(),
      discoverProjectAgentsSkills(directory),
      discoverGlobalAgentsSkills(),
    ])

  // Priority: opencode-project > opencode > config paths > project (.claude + .agents) > user (.claude + .agents)
  return deduplicateSkillsByName([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...configPathsSkills,
    ...projectSkills,
    ...agentsProjectSkills,
    ...userSkills,
    ...agentsGlobalSkills,
  ])
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true, directory } = options

  const [opencodeProjectSkills, opencodeGlobalSkills, configPathsSkills] = await Promise.all([
    discoverOpencodeProjectSkills(directory),
    discoverOpencodeGlobalSkills(),
    discoverConfigPathsSkills(directory),
  ])

  if (!includeClaudeCodePaths) {
    // Priority: opencode-project > opencode > config paths
    return deduplicateSkillsByName([...opencodeProjectSkills, ...opencodeGlobalSkills, ...configPathsSkills])
  }

  const [projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] = await Promise.all([
    discoverProjectClaudeSkills(directory),
    discoverUserClaudeSkills(),
    discoverProjectAgentsSkills(directory),
    discoverGlobalAgentsSkills(),
  ])

  // Priority: opencode-project > opencode > config paths > project (.claude + .agents) > user (.claude + .agents)
  return deduplicateSkillsByName([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...configPathsSkills,
    ...projectSkills,
    ...agentsProjectSkills,
    ...userSkills,
    ...agentsGlobalSkills,
  ])
}

export async function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): Promise<LoadedSkill | undefined> {
  const skills = await discoverSkills(options)
  return skills.find(s => s.name === name)
}

export async function discoverUserClaudeSkills(): Promise<LoadedSkill[]> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  return loadSkillsFromDir({ skillsDir: userSkillsDir, scope: "user" })
}

export async function discoverProjectClaudeSkills(directory?: string): Promise<LoadedSkill[]> {
  const projectSkillDirs = findProjectClaudeSkillDirs(directory ?? process.cwd())
  const allSkills = await Promise.all(
    projectSkillDirs.map((skillsDir) => loadSkillsFromDir({ skillsDir, scope: "project" })),
  )
  return deduplicateSkillsByName(allSkills.flat())
}

export async function discoverOpencodeGlobalSkills(): Promise<LoadedSkill[]> {
  const skillDirs = getOpenCodeSkillDirs({ binary: "opencode" })
  const allSkills = await Promise.all(
    skillDirs.map(skillsDir => loadSkillsFromDir({ skillsDir, scope: "opencode" }))
  )
  return deduplicateSkillsByName(allSkills.flat())
}

export async function discoverOpencodeProjectSkills(directory?: string): Promise<LoadedSkill[]> {
  const opencodeProjectSkillDirs = findProjectOpencodeSkillDirs(
    directory ?? process.cwd(),
  )
  const allSkills = await Promise.all(
    opencodeProjectSkillDirs.map((skillsDir) =>
      loadSkillsFromDir({ skillsDir, scope: "opencode-project" }),
    ),
  )
  return deduplicateSkillsByName(allSkills.flat())
}

export async function discoverProjectAgentsSkills(directory?: string): Promise<LoadedSkill[]> {
  const agentsProjectSkillDirs = findProjectAgentsSkillDirs(directory ?? process.cwd())
  const allSkills = await Promise.all(
    agentsProjectSkillDirs.map((skillsDir) => loadSkillsFromDir({ skillsDir, scope: "project" })),
  )
  return deduplicateSkillsByName(allSkills.flat())
}

export async function discoverGlobalAgentsSkills(homeDirectory: string = homedir()): Promise<LoadedSkill[]> {
  const agentsGlobalDir = join(homeDirectory, ".agents", "skills")
  return loadSkillsFromDir({ skillsDir: agentsGlobalDir, scope: "user" })
}

export async function discoverConfigPathsSkills(directory?: string): Promise<LoadedSkill[]> {
  const paths = readOpenCodeSkillsPaths(directory ?? process.cwd())
  if (paths.length === 0) return []

  const results = await Promise.all(
    paths.map(skillsDir => loadSkillsFromDir({ skillsDir, scope: "config" }))
  )
  return deduplicateSkillsByName(results.flat())
}

export async function loadConfigPathsSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const skills = await discoverConfigPathsSkills(directory)
  return skillsToCommandDefinitionRecord(skills)
}
