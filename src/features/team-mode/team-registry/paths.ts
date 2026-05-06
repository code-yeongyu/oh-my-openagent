import { mkdir, readdir, stat, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"

type TeamSpecEntry = {
  name: string
  scope: "project" | "user"
  path: string
}

function getTeamDirectory(baseDir: string, teamName: string, scope: "user" | "project", projectRoot?: string): string {
  if (scope === "project") {
    return path.join(projectRoot ?? "", ".omo", "teams", teamName)
  }

  return path.join(baseDir, "teams", teamName)
}

export function resolveBaseDir(config: TeamModeConfig): string {
  return config.base_dir ?? path.join(homedir(), ".omo")
}

export function getTeamSpecPath(
  baseDir: string,
  teamName: string,
  scope: "user" | "project",
  projectRoot?: string,
): string {
  return path.join(getTeamDirectory(baseDir, teamName, scope, projectRoot), "config.json")
}

export function getRuntimeStateDir(baseDir: string, teamRunId: string): string {
  return path.join(baseDir, "runtime", teamRunId)
}

export function getInboxDir(baseDir: string, teamRunId: string, memberName: string): string {
  return path.join(baseDir, "runtime", teamRunId, "inboxes", memberName)
}

export function getTasksDir(baseDir: string, teamRunId: string): string {
  return path.join(baseDir, "runtime", teamRunId, "tasks")
}

export function getWorktreeDir(baseDir: string, teamRunId: string, memberName: string): string {
  return path.join(baseDir, "worktrees", teamRunId, memberName)
}

async function readTeamSpecDirectories(directoryPath: string, scope: "project" | "user"): Promise<TeamSpecEntry[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        scope,
        path: path.resolve(directoryPath, entry.name, "config.json"),
      }))
  } catch {
    return []
  }
}

export async function discoverTeamSpecs(
  config: TeamModeConfig,
  projectRoot: string,
): Promise<Array<{ name: string; scope: "project" | "user"; path: string }>> {
  const baseDir = resolveBaseDir(config)
  const projectTeamsDir = path.resolve(projectRoot, ".omo", "teams")
  const userTeamsDir = path.resolve(baseDir, "teams")

  const [projectTeamSpecs, userTeamSpecs] = await Promise.all([
    readTeamSpecDirectories(projectTeamsDir, "project"),
    readTeamSpecDirectories(userTeamsDir, "user"),
  ])

  const discoveredTeamSpecs: TeamSpecEntry[] = [...projectTeamSpecs]
  const projectTeamNames = new Set(projectTeamSpecs.map((entry) => entry.name))

  for (const userTeamSpec of userTeamSpecs) {
    if (projectTeamNames.has(userTeamSpec.name)) {
      const projectTeamSpec = projectTeamSpecs.find((entry) => entry.name === userTeamSpec.name)
      if (projectTeamSpec) {
        log("team-spec collision", {
          event: "team-spec-collision",
          teamName: userTeamSpec.name,
          projectPath: projectTeamSpec.path,
          userPath: userTeamSpec.path,
        })
      }
      continue
    }

    discoveredTeamSpecs.push(userTeamSpec)
  }

  return discoveredTeamSpecs
}

export async function ensureBaseDirs(baseDir: string): Promise<void> {
  const directories = [
    baseDir,
    path.join(baseDir, "teams"),
    path.join(baseDir, "runtime"),
    path.join(baseDir, "worktrees"),
  ]

  for (const directoryPath of directories) {
    await mkdir(directoryPath, { recursive: true, mode: 0o700 })
    await chmod(directoryPath, 0o700)
  }

  await Promise.all(directories.map(async (directoryPath) => {
    const directoryStat = await stat(directoryPath)
    if ((directoryStat.mode & 0o777) !== 0o700) {
      await chmod(directoryPath, 0o700)
    }
  }))
}
