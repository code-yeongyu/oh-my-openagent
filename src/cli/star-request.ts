export const STAR_REPOSITORIES = [
  "code-yeongyu/oh-my-openagent",
  "code-yeongyu/lazycodex",
] as const

export function formatGitHubStarCommand(repository: string): string {
  return `gh api --silent --method PUT /user/starred/${repository} >/dev/null 2>&1 || true`
}
