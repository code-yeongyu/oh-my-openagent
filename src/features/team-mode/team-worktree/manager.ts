import path from "node:path"
import { spawn as bunSpawn } from "../../../shared/bun-spawn-shim"

export type TeamModeConfig = {
  worktreeBaseDir?: string
}

export class GitUnavailableError extends Error {
  constructor() {
    super("git required for worktree members")
    this.name = "GitUnavailableError"
  }
}

function countParentSegments(spec: string): number {
  return spec.split("/").filter((segment) => segment === "..").length
}

async function runGit(args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  const process = bunSpawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderrBytes] = await Promise.all([process.exited, new Response(process.stderr).text()])
  return { code: exitCode, stderr: stderrBytes }
}

let gitCommandRunner = runGit

export function setGitCommandRunnerForTests(runner: typeof runGit): void {
  gitCommandRunner = runner
}

export async function isGitAvailable(): Promise<boolean> {
  const result = await gitCommandRunner(["--version"])
  return result.code === 0
}

export function validateWorktreeSpec(spec: string): void {
  if (!/^(\.\.?\/|\/).+/.test(spec) || countParentSegments(spec) > 2) {
    throw new Error("worktreePath must be a filesystem path (relative './...', '../...' or absolute '/...')")
  }
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath)
  const normalizedRoot = path.resolve(rootPath)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
}

export function resolveSandboxedWorktreePath(
  repoRoot: string,
  worktreePath: string,
  config: TeamModeConfig,
): string {
  validateWorktreeSpec(worktreePath)

  const absolutePath = path.isAbsolute(worktreePath)
    ? path.resolve(worktreePath)
    : path.resolve(repoRoot, worktreePath)

  const allowedRoots = [path.resolve(repoRoot)]
  if (config.worktreeBaseDir) {
    allowedRoots.push(path.resolve(config.worktreeBaseDir))
  }

  if (!allowedRoots.some((rootPath) => isWithinRoot(absolutePath, rootPath))) {
    throw new Error("worktreePath must stay inside the repository root or configured worktree base directory")
  }

  return absolutePath
}

export async function createWorktree(
  repoRoot: string,
  _teamRunId: string,
  _memberName: string,
  worktreePath: string,
  config: TeamModeConfig,
): Promise<string> {
  if (!(await isGitAvailable())) {
    throw new GitUnavailableError()
  }

  const absolutePath = resolveSandboxedWorktreePath(repoRoot, worktreePath, config)
  const result = await gitCommandRunner(["-C", repoRoot, "worktree", "add", "--detach", absolutePath])

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git worktree add failed")
  }

  return absolutePath
}
