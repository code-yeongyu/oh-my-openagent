import { checkTeamModeDependencies } from "../../../features/team-mode/deps"
import { resolveBaseDir } from "../../../features/team-mode/team-registry/paths"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult } from "../types"
import { readFileSync, promises as fs } from "node:fs"
import path from "node:path"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"

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
  const projectConfig = detectPluginConfigFile(path.join(process.cwd(), ".opencode"))
  const userConfig = detectPluginConfigFile(getOpenCodeConfigDir({ binary: "opencode" }))
  const configPath = projectConfig.format !== "none" ? projectConfig.path : userConfig.path
  if (!configPath) return { team_mode: undefined }
  try {
    return parseJsonc<{ team_mode?: { enabled?: boolean } }>(readFileSync(configPath, "utf-8"))
  } catch {
    return { team_mode: undefined }
  }
}

async function safeCount(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).length
  } catch {
    return 0
  }
}

async function pathExists(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dir)
    return stats.isDirectory()
  } catch {
    return false
  }
}
