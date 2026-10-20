import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { resolveOmoGitMasterSettings, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { buildSkillPrepend, createFsSkillLoader, type SkillLoader } from "@oh-my-opencode/senpi-task"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { resolveGitMasterSkillAdditions } from "../git-master/skill-content"

const GIT_MASTER_SKILL_NAME = "git-master"

export interface TaskSkillLoaderOptions {
  readonly agentDir?: string
  readonly homeDir?: string
  readonly pluginSkillsDirs?: readonly string[]
  readonly loadSettings?: (cwd: string) => OmoGitMasterSettings
}

/**
 * Both candidate pairs cover the two layouts this module ships in: the source tree
 * (`packages/omo-senpi/src/components/task`) and the bundled runtime (`plugin/extensions`).
 * `skills-conditional` holds credential-gated skills (x-search); it is offered to every
 * `load_skills` request unconditionally because the PARENT decides what to pass.
 */
export function packagedSkillDirs(moduleUrl: string): readonly string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl))
  return [
    resolve(moduleDir, "../../../plugin/skills"),
    resolve(moduleDir, "../skills"),
    resolve(moduleDir, "../../../plugin/skills-conditional"),
    resolve(moduleDir, "../skills-conditional"),
  ].filter(existsSync)
}

function defaultLoadSettings(cwd: string): OmoGitMasterSettings {
  return resolveOmoGitMasterSettings(loadSenpiOmoConfig({ cwd }).config)
}

function withGitMasterSettings(
  loader: SkillLoader,
  loadSettings: (cwd: string) => OmoGitMasterSettings,
): SkillLoader {
  return (names, cwd) => {
    const resolution = loader(names, cwd)
    const resolvedSkills = resolution.skills ?? []
    if (!resolvedSkills.some((skill) => skill.name === GIT_MASTER_SKILL_NAME)) return resolution
    const additions = resolveGitMasterSkillAdditions(loadSettings(cwd))
    if (additions === undefined) return resolution
    const skills = resolvedSkills.map((skill) => {
      if (skill.name !== GIT_MASTER_SKILL_NAME) return skill
      const content = additions.rewriteSkillText(skill.content)
      return { ...skill, content: additions.directive === undefined ? content : `${content}\n\n${additions.directive}` }
    })
    return { ...resolution, skills, prepend: buildSkillPrepend(skills, "") }
  }
}

export function createTaskSkillLoader(options: TaskSkillLoaderOptions = {}): SkillLoader {
  const homeDir = options.homeDir ?? homedir()
  const agentDir = options.agentDir ?? resolveAgentHome({ env: process.env, homeDir })
  const pluginSkillsDirs = options.pluginSkillsDirs ?? packagedSkillDirs(import.meta.url)
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  const loader = createFsSkillLoader({
    homeDir,
    agentDir,
    extraDirs: pluginSkillsDirs,
  })
  return withGitMasterSettings(loader, loadSettings)
}
