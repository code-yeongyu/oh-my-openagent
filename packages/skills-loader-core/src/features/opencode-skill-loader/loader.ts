import { join } from "path"
import { homedir } from "os"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import {
  findProjectAgentsSkillDirs,
  findProjectClaudeSkillDirs,
  findProjectOpencodeSkillDirs,
  getClaudeConfigDir,
  getOpenCodeSkillDirs,
} from "../../shared"
import {
  type CommandDefinition,
} from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import { matchSkillByName } from "../../tools/skill/skill-matcher"
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

export function createSharedCanonicalAliases(skills: LoadedSkill[]): LoadedSkill[] {
  return skills.map((skill) => {
    const name = `shared/${skill.name}`
    return {
      ...skill,
      name,
      definition: {
        ...skill.definition,
        name,
      },
    }
  })
}

export async function discoverAllSkills(directory?: string): Promise<LoadedSkill[]> {
  const [opencodeProjectSkills, opencodeGlobalSkills, sharedSkills, projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] =
    await Promise.all([
      discoverOpencodeProjectSkills(directory),
      discoverOpencodeGlobalSkills(),
      discoverSharedSkills(),
      discoverProjectClaudeSkills(directory),
      discoverUserClaudeSkills(),
      discoverProjectAgentsSkills(directory),
      discoverGlobalAgentsSkills(),
    ])

  return deduplicateSkillsByName([
    ...createSharedCanonicalAliases(sharedSkills),
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...projectSkills,
    ...agentsProjectSkills,
    ...userSkills,
    ...agentsGlobalSkills,
    ...sharedSkills,
  ])
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true, directory } = options

  const [opencodeProjectSkills, opencodeGlobalSkills, sharedSkills] = await Promise.all([
    discoverOpencodeProjectSkills(directory),
    discoverOpencodeGlobalSkills(),
    discoverSharedSkills(),
  ])

  if (!includeClaudeCodePaths) {
    return deduplicateSkillsByName([
      ...createSharedCanonicalAliases(sharedSkills),
      ...opencodeProjectSkills,
      ...opencodeGlobalSkills,
      ...sharedSkills,
    ])
  }

  const [projectSkills, userSkills, agentsProjectSkills, agentsGlobalSkills] = await Promise.all([
    discoverProjectClaudeSkills(directory),
    discoverUserClaudeSkills(),
    discoverProjectAgentsSkills(directory),
    discoverGlobalAgentsSkills(),
  ])

  return deduplicateSkillsByName([
    ...createSharedCanonicalAliases(sharedSkills),
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...projectSkills,
    ...agentsProjectSkills,
    ...userSkills,
    ...agentsGlobalSkills,
    ...sharedSkills,
  ])
}

export async function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): Promise<LoadedSkill | undefined> {
  const skills = await discoverSkills(options)
  return matchSkillByName(skills, name)
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

export async function discoverSharedSkills(): Promise<LoadedSkill[]> {
  return loadSkillsFromDir({ skillsDir: sharedSkillsRootPath(), scope: "shared" })
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
