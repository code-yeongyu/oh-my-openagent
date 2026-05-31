import { execFile } from "node:child_process"
import { promisify } from "node:util"

export const STAR_REPOSITORIES = [
  "code-yeongyu/oh-my-openagent",
  "code-yeongyu/lazycodex",
] as const

const execFileAsync = promisify(execFile)

export interface GitHubStarResult {
  readonly repository: string
  readonly ok: boolean
  readonly error?: string
}

export type GitHubStarCommandRunner = (repository: string) => Promise<void>

export function formatGitHubStarCommand(repository: string): string {
  return `gh api --silent --method PUT /user/starred/${repository} >/dev/null 2>&1 || true`
}

export async function runGitHubStarCommand(repository: string): Promise<void> {
  await execFileAsync("gh", ["api", "--silent", "--method", "PUT", `/user/starred/${repository}`])
}

export async function starGitHubRepositories(
  repositories: readonly string[] = STAR_REPOSITORIES,
  runCommand: GitHubStarCommandRunner = runGitHubStarCommand,
): Promise<readonly GitHubStarResult[]> {
  const results: GitHubStarResult[] = []
  for (const repository of repositories) {
    try {
      await runCommand(repository)
      results.push({ repository, ok: true })
    } catch (error) {
      results.push({ repository, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
