import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createFsSkillLoader, type SkillLoader } from "@oh-my-opencode/senpi-task"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"

export interface TaskSkillLoaderOptions {
  readonly agentDir?: string
  readonly homeDir?: string
  readonly pluginSkillsDirs?: readonly string[]
}

function packagedSkillDirs(moduleUrl: string): readonly string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl))
  return [
    resolve(moduleDir, "../../../plugin/skills"),
    resolve(moduleDir, "../skills"),
  ].filter(existsSync)
}

export function createTaskSkillLoader(options: TaskSkillLoaderOptions = {}): SkillLoader {
  const homeDir = options.homeDir ?? homedir()
  const agentDir = options.agentDir ?? resolveAgentHome({ env: process.env, homeDir })
  const pluginSkillsDirs = options.pluginSkillsDirs ?? packagedSkillDirs(import.meta.url)
  return createFsSkillLoader({
    homeDir,
    agentDir,
    extraDirs: pluginSkillsDirs,
  })
}
