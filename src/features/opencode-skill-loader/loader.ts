import { join } from "path"
import { homedir } from "os"
import { readdir } from "node:fs/promises"
import { getClaudeConfigDir } from "../../shared/claude-config-dir"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { getOpenCodeSkillDirs } from "../../shared/opencode-command-dirs"
import { getOpenCodeCacheDir } from "../../shared/data-path"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { LoadedSkill } from "./types"
import { skillsToCommandDefinitionRecord } from "./skill-definition-record"
import { deduplicateSkillsByName } from "./skill-deduplication"
import { loadSkillsFromDir } from "./skill-directory-loader"

export async function loadUserSkills(): Promise<Record<string, CommandDefinition>> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  const skills = await loadSkillsFromDir({ skillsDir: userSkillsDir, scope: "user" })
  return skillsToCommandDefinitionRecord(skills)
}

export async function loadProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const projectSkillsDir = join(directory ?? process.cwd(), ".claude", "skills")
  const skills = await loadSkillsFromDir({ skillsDir: projectSkillsDir, scope: "project" })
  return skillsToCommandDefinitionRecord(skills)
}

export async function loadOpencodeGlobalSkills(): Promise<Record<string, CommandDefinition>> {
  const skillDirs = getOpenCodeSkillDirs({ binary: "opencode" })
  const allSkills = await Promise.all(
    skillDirs.map(skillsDir => loadSkillsFromDir({ skillsDir, scope: "opencode" }))
  )
  const bundledPluginSkills = await discoverOpencodePluginBundledSkills()
  return skillsToCommandDefinitionRecord(
    deduplicateSkillsByName([...allSkills.flat(), ...bundledPluginSkills])
  )
}

export async function loadOpencodeProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>> {
  const opencodeProjectDir = join(directory ?? process.cwd(), ".opencode", "skills")
  const skills = await loadSkillsFromDir({ skillsDir: opencodeProjectDir, scope: "opencode-project" })
  return skillsToCommandDefinitionRecord(skills)
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
  directory?: string
}

export async function discoverAllSkills(directory?: string): Promise<LoadedSkill[]> {
  const [opencodeProjectSkills, opencodeGlobalSkills, bundledPluginSkills, projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] =
    await Promise.all([
      discoverOpencodeProjectSkills(directory),
      discoverOpencodeGlobalSkills(),
      discoverOpencodePluginBundledSkills(),
      discoverProjectClaudeSkills(directory),
      discoverUserClaudeSkills(),
      discoverProjectAgentsSkills(directory),
      discoverGlobalAgentsSkills(),
    ])

  // Priority: opencode-project > opencode > project (.claude + .agents) > user (.claude + .agents)
  return deduplicateSkillsByName([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...bundledPluginSkills,
    ...projectSkills,
    ...agentsProjectSkills,
    ...userSkills,
    ...agentsGlobalSkills,
  ])
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true, directory } = options

  const [opencodeProjectSkills, opencodeGlobalSkills, bundledPluginSkills] = await Promise.all([
    discoverOpencodeProjectSkills(directory),
    discoverOpencodeGlobalSkills(),
    discoverOpencodePluginBundledSkills(),
  ])

  if (!includeClaudeCodePaths) {
    // Priority: opencode-project > opencode
    return deduplicateSkillsByName([
      ...opencodeProjectSkills,
      ...opencodeGlobalSkills,
      ...bundledPluginSkills,
    ])
  }

  const [projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] = await Promise.all([
    discoverProjectClaudeSkills(directory),
    discoverUserClaudeSkills(),
    discoverProjectAgentsSkills(directory),
    discoverGlobalAgentsSkills(),
  ])

  // Priority: opencode-project > opencode > project (.claude + .agents) > user (.claude + .agents)
  return deduplicateSkillsByName([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...bundledPluginSkills,
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
  const projectSkillsDir = join(directory ?? process.cwd(), ".claude", "skills")
  return loadSkillsFromDir({ skillsDir: projectSkillsDir, scope: "project" })
}

export async function discoverOpencodeGlobalSkills(): Promise<LoadedSkill[]> {
  const skillDirs = getOpenCodeSkillDirs({ binary: "opencode" })
  const allSkills = await Promise.all(
    skillDirs.map(skillsDir => loadSkillsFromDir({ skillsDir, scope: "opencode" }))
  )
  return deduplicateSkillsByName(allSkills.flat())
}

async function discoverOpencodePluginBundledSkills(): Promise<LoadedSkill[]> {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const nodeModulesDirs = deduplicatePaths([
    join(configDir, "node_modules"),
    join(getOpenCodeCacheDir(), "node_modules"),
  ])

  const packageRoots = (
    await Promise.all(nodeModulesDirs.map(dir => discoverNodeModulesPackageRoots(dir)))
  ).flat()

  const skillGroups = await Promise.all(
    packageRoots.map(async ({ packageName, packageRoot }) => {
      const pluginDir = join(packageRoot, ".opencode", "plugins")
      const skillsDir = join(packageRoot, "skills")
      const pluginEntries = await readdir(pluginDir, { withFileTypes: true }).catch(() => [])
      const hasPluginEntry = pluginEntries.some(
        entry =>
          !entry.name.startsWith(".") &&
          !entry.isDirectory() &&
          /\.(?:[cm]?js|ts)$/.test(entry.name)
      )

      if (!hasPluginEntry) {
        return []
      }

      return loadSkillsFromDir({
        skillsDir,
        scope: "opencode",
        namePrefix: packageName,
      })
    })
  )

  return deduplicateSkillsByName(skillGroups.flat())
}

interface NodeModulesPackageRoot {
  packageName: string
  packageRoot: string
}

async function discoverNodeModulesPackageRoots(nodeModulesDir: string): Promise<NodeModulesPackageRoot[]> {
  const entries = await readdir(nodeModulesDir, { withFileTypes: true }).catch(() => [])
  const packageRoots: NodeModulesPackageRoot[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }

    const entryPath = join(nodeModulesDir, entry.name)
    if (entry.name.startsWith("@")) {
      const scopedEntries = await readdir(entryPath, { withFileTypes: true }).catch(() => [])
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.name.startsWith(".")) {
          continue
        }
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          packageRoots.push({
            packageName: `${entry.name}/${scopedEntry.name}`,
            packageRoot: join(entryPath, scopedEntry.name),
          })
        }
      }
      continue
    }

    packageRoots.push({
      packageName: entry.name,
      packageRoot: entryPath,
    })
  }

  return packageRoots
}

function deduplicatePaths(paths: string[]): string[] {
  return Array.from(new Set(paths))
}

export async function discoverOpencodeProjectSkills(directory?: string): Promise<LoadedSkill[]> {
  const opencodeProjectDir = join(directory ?? process.cwd(), ".opencode", "skills")
  return loadSkillsFromDir({ skillsDir: opencodeProjectDir, scope: "opencode-project" })
}

export async function discoverProjectAgentsSkills(directory?: string): Promise<LoadedSkill[]> {
  const agentsProjectDir = join(directory ?? process.cwd(), ".agents", "skills")
  return loadSkillsFromDir({ skillsDir: agentsProjectDir, scope: "project" })
}

export async function discoverGlobalAgentsSkills(): Promise<LoadedSkill[]> {
  const agentsGlobalDir = join(homedir(), ".agents", "skills")
  return loadSkillsFromDir({ skillsDir: agentsGlobalDir, scope: "user" })
}
