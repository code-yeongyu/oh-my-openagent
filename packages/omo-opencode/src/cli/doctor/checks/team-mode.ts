import { validatePluginConfig } from "../../../config/validate"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { checkTeamModeDependencies } from "../../../features/team-mode/deps"
import { resolveBaseDir } from "../../../features/team-mode/team-registry/paths"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult } from "../framework/types"
import { promises as fs } from "node:fs"
import path from "node:path"

export async function checkTeamMode(): Promise<CheckResult> {
  const config = loadTeamModeConfig()
  const teamModeConfig = TeamModeConfigSchema.parse(config.team_mode ?? {})
  if (!teamModeConfig.enabled) {
    return { name: CHECK_NAMES[CHECK_IDS.TEAM_MODE], status: "skip", message: "team_mode: disabled", issues: [] }
  }

  const deps = await checkTeamModeDependencies(teamModeConfig)
  const baseDir = resolveBaseDir(teamModeConfig)
  const [baseDirExists, teamCount, runtimeCount] = await Promise.all([
    pathExists(baseDir),
    safeCount(path.join(baseDir, "teams")),
    safeCount(path.join(baseDir, "runtime")),
  ])
  const baseDirMessage = baseDirExists ? `base dir: ok` : `base dir: missing (plugin init will create it on first use)`

  return {
    name: CHECK_NAMES[CHECK_IDS.TEAM_MODE],
    status: deps.tmuxAvailable && deps.gitAvailable ? "pass" : "warn",
    message: `team_mode: enabled | tmux: ${deps.tmuxAvailable ? "ok" : "missing"} | git: ${deps.gitAvailable ? "ok" : "missing"} | ${baseDirMessage} | declared: ${teamCount} | runtime dirs: ${runtimeCount}`,
    details: undefined,
    issues: [],
  }
}

function loadTeamModeConfig() {
  return validatePluginConfig(process.cwd()).config
}

async function safeCount(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).length
  } catch (error) {
    if (error instanceof Error) {
      return 0
    }

    throw error
  }
}

async function pathExists(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dir)
    return stats.isDirectory()
  } catch (error) {
    if (error instanceof Error) {
      return false
    }

    throw error
  }
}
