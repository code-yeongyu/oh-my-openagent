import { mkdir, readdir, stat, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { log } from "../logger"

type TeamSpecEntry = {
  name: string
  scope: "project" | "user"
  path: string
}

type PathDeps = {
  readonly chmod: typeof chmod
  readonly log: typeof log
  readonly mkdir: typeof mkdir
  readonly stat: typeof stat
}

const defaultPathDeps = {
  chmod,
  log,
  mkdir,
  stat,
} satisfies PathDeps

export class TeamPathTraversalError extends Error {
  constructor() {
    super("team path escapes base directory")
    this.name = "TeamPathTraversalError"
  }
}

function resolveContainedPath(baseDir: string, pathSegments: readonly string[]): string {
  for (const pathSegment of pathSegments) {
    if (
      pathSegment.length === 0 ||
      pathSegment === "." ||
      pathSegment === ".." ||
      pathSegment.includes("/") ||
      pathSegment.includes("\\") ||
      pathSegment.includes("\0")
    ) {
      throw new TeamPathTraversalError()
    }
  }

  const resolvedBaseDir = path.resolve(baseDir)
  const resolvedPath = path.resolve(resolvedBaseDir, ...pathSegments)
  const relativePath = path.relative(resolvedBaseDir, resolvedPath)

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new TeamPathTraversalError()
  }

  return resolvedPath
}

export function resolveBaseDir(config: TeamModeConfig): string {
  return expandHomeDirectory(config.base_dir ?? path.join(homedir(), ".omo"))
}

function expandHomeDirectory(directoryPath: string): string {
  if (directoryPath === "~") {
    return homedir()
  }

  if (directoryPath.startsWith("~/") || directoryPath.startsWith("~\\")) {
    return path.join(homedir(), directoryPath.slice(2))
  }

  return directoryPath
}

export function getTeamSpecPath(
  baseDir: string,
  teamName: string,
  scope: "user" | "project",
  projectRoot?: string,
): string {
  const teamSpecRoot = scope === "project"
    ? path.join(projectRoot ?? "", ".omo", "teams")
    : path.join(baseDir, "teams")

  return resolveContainedPath(teamSpecRoot, [teamName, "config.json"])
}

export function getRuntimeStateDir(baseDir: string, teamRunId: string): string {
  return resolveContainedPath(baseDir, ["runtime", teamRunId])
}

export function getInboxDir(baseDir: string, teamRunId: string, memberName: string): string {
  return resolveContainedPath(baseDir, ["runtime", teamRunId, "inboxes", memberName])
}

export function getTasksDir(baseDir: string, teamRunId: string): string {
  return resolveContainedPath(baseDir, ["runtime", teamRunId, "tasks"])
}

function assertSafeTaskId(taskId: string): void {
  if (!/^\d+$/.test(taskId)) {
    throw new TeamPathTraversalError()
  }
}

export function getTaskFilePath(baseDir: string, teamRunId: string, taskId: string): string {
  assertSafeTaskId(taskId)
  return resolveContainedPath(baseDir, ["runtime", teamRunId, "tasks", `${taskId}.json`])
}

export function getTaskClaimsDir(baseDir: string, teamRunId: string): string {
  return resolveContainedPath(baseDir, ["runtime", teamRunId, "tasks", "claims"])
}

export function getTaskClaimLockPath(baseDir: string, teamRunId: string, taskId: string): string {
  assertSafeTaskId(taskId)
  return resolveContainedPath(baseDir, ["runtime", teamRunId, "tasks", "claims", `${taskId}.lock`])
}

export function getWorktreeDir(baseDir: string, teamRunId: string, memberName: string): string {
  return resolveContainedPath(baseDir, ["worktrees", teamRunId, memberName])
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
  } catch (error) {
    error instanceof Error
    return []
  }
}

export async function discoverTeamSpecs(
  config: TeamModeConfig,
  projectRoot: string,
  deps: Pick<PathDeps, "log"> = defaultPathDeps,
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
        deps.log("team-spec collision", {
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

type ErrnoLike = {
  readonly code?: unknown
  readonly syscall?: unknown
}

function isErrnoLike(error: unknown): error is ErrnoLike {
  return typeof error === "object" && error !== null
}

async function safeChmod(directoryPath: string, mode: number, deps: Pick<PathDeps, "chmod" | "log">): Promise<void> {
  try {
    await deps.chmod(directoryPath, mode)
  } catch (error) {
    const code = isErrnoLike(error) && typeof error.code === "string" ? error.code : undefined
    if (code === "EPERM" || code === "ENOTSUP" || code === "EINVAL") {
      deps.log("team-mode: chmod refused on base directory; continuing with existing permissions", {
        path: directoryPath,
        code,
        syscall: isErrnoLike(error) && typeof error.syscall === "string" ? error.syscall : undefined,
      })
      return
    }
    throw error
  }
}

export async function ensureBaseDirs(baseDir: string, deps: PathDeps = defaultPathDeps): Promise<void> {
  const directories = [
    baseDir,
    path.join(baseDir, "teams"),
    path.join(baseDir, "runtime"),
    path.join(baseDir, "worktrees"),
  ]

  for (const directoryPath of directories) {
    await deps.mkdir(directoryPath, { recursive: true, mode: 0o700 })
    await safeChmod(directoryPath, 0o700, deps)
  }

  await Promise.all(directories.map(async (directoryPath) => {
    const directoryStat = await deps.stat(directoryPath)
    if ((directoryStat.mode & 0o777) !== 0o700) {
      await safeChmod(directoryPath, 0o700, deps)
    }
  }))
}
