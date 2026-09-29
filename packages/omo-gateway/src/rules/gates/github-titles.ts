// GitHub issue/PR titles for the link_label gate, cached per process. The fetcher is injectable so
// tests never reach GitHub; the default shells out to `gh api` with a bounded timeout.

export interface GithubTitleResolver {
  title(owner: string, repo: string, number: number): Promise<string>
}

export type GithubTitleFetcher = (owner: string, repo: string, number: number) => Promise<string>

export interface GithubTitleCacheOptions {
  readonly fetchTitle?: GithubTitleFetcher
  readonly ttlMs?: number
  readonly now?: () => number
}

export const GITHUB_TITLE_TTL_MS = 3_600_000
const GH_TIMEOUT_MS = 10_000
const SLUG_RE = /^[A-Za-z0-9_.-]+$/

export const ghApiTitle: GithubTitleFetcher = async (owner, repo, number) => {
  if (!SLUG_RE.test(owner) || !SLUG_RE.test(repo) || !Number.isSafeInteger(number)) {
    throw new Error(`not a GitHub issue reference: ${owner}/${repo}#${number}`)
  }
  const child = Bun.spawn(["gh", "api", `repos/${owner}/${repo}/issues/${number}`, "--jq", ".title"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const title = stdout.trim()
  if (code !== 0 || title.length === 0) {
    throw new Error(`gh api exited ${code}: ${stderr.trim().split("\n")[0] ?? "no output"}`)
  }
  return title
}

export function createGithubTitleCache(options: GithubTitleCacheOptions = {}): GithubTitleResolver {
  const fetchTitle = options.fetchTitle ?? ghApiTitle
  const ttlMs = options.ttlMs ?? GITHUB_TITLE_TTL_MS
  const now = options.now ?? Date.now
  const entries = new Map<string, { readonly title: string; readonly at: number }>()
  return {
    async title(owner, repo, number) {
      const key = `${owner}/${repo}#${number}`.toLowerCase()
      const cached = entries.get(key)
      if (cached !== undefined && now() - cached.at < ttlMs) return cached.title
      const title = await fetchTitle(owner, repo, number)
      entries.set(key, { title, at: now() })
      return title
    },
  }
}

let defaultResolver: GithubTitleResolver | null = null

export function defaultGithubTitles(): GithubTitleResolver {
  defaultResolver ??= createGithubTitleCache()
  return defaultResolver
}
