export const GITHUB_REPOSITORY = "code-yeongyu/oh-my-openagent"

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "omo-web",
  }
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}
