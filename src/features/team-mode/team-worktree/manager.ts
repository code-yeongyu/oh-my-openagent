import path from "node:path"

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
  const process = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
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

export async function createWorktree(
  repoRoot: string,
  _teamRunId: string,
  _memberName: string,
  worktreePath: string,
  _config: TeamModeConfig,
): Promise<string> {
  validateWorktreeSpec(worktreePath)

  if (!(await isGitAvailable())) {
    throw new GitUnavailableError()
  }

  const absolutePath = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(repoRoot, worktreePath)
  const result = await gitCommandRunner(["-C", repoRoot, "worktree", "add", "--detach", absolutePath])

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git worktree add failed")
  }

  return absolutePath
}
