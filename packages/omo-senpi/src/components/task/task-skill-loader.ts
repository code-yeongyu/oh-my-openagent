import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { resolveOmoGitMasterSettings, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { buildSkillPrepend, createFsSkillLoader, type SkillLoader } from "@oh-my-opencode/senpi-task"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { buildGitMasterAttributionDirective } from "../git-master/directive"

const GIT_MASTER_SKILL_NAME = "git-master"

export interface TaskSkillLoaderOptions {
  readonly agentDir?: string
  readonly homeDir?: string
  readonly pluginSkillsDirs?: readonly string[]
  readonly loadSettings?: (cwd: string) => OmoGitMasterSettings
}

function packagedSkillDirs(moduleUrl: string): readonly string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl))
  return [
    resolve(moduleDir, "../../../plugin/skills"),
    resolve(moduleDir, "../skills"),
  ].filter(existsSync)
}

function defaultLoadSettings(cwd: string): OmoGitMasterSettings {
  return resolveOmoGitMasterSettings(loadSenpiOmoConfig({ cwd }).config)
}

function withGitMasterAttribution(
  loader: SkillLoader,
  loadSettings: (cwd: string) => OmoGitMasterSettings,
): SkillLoader {
  return (names, cwd) => {
    const resolution = loader(names, cwd)
    const resolvedSkills = resolution.skills ?? []
    if (!resolvedSkills.some((skill) => skill.name === GIT_MASTER_SKILL_NAME)) return resolution
    const directive = buildGitMasterAttributionDirective(loadSettings(cwd))
    if (directive === undefined) return resolution
    const skills = resolvedSkills.map((skill) =>
      skill.name === GIT_MASTER_SKILL_NAME
        ? { ...skill, content: `${skill.content}\n\n${directive}` }
        : skill,
    )
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
  return withGitMasterAttribution(loader, loadSettings)
}
