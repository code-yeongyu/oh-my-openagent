import { $ } from "bun"
import { z } from "zod"

const NPM_PACKAGES = ["oh-my-opencode", "oh-my-openagent", "lazycodex-ai"] as const
const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/"
const GITHUB_REPOSITORY = "code-yeongyu/oh-my-openagent"

const NpmDownloadsSchema = z.object({
  downloads: z.number().int().nonnegative(),
})

const GitHubAssetSchema = z.object({
  download_count: z.number().int().nonnegative(),
})

const GitHubReleaseSchema = z.object({
  assets: z.array(GitHubAssetSchema),
})

type DownloadSource = "npm" | "github_release"

export type DownloadStat = {
  readonly count: number
  readonly packageName: string
  readonly source: DownloadSource
}

type PostHogDownloadEvent = {
  readonly api_key: string
  readonly event: "omo_download_stats"
  readonly distinct_id: "download"
  readonly properties: {
    readonly $process_person_profile: false
    readonly count: number
    readonly package_name: string
    readonly source: DownloadSource
  }
}

type StatsDeps = {
  readonly fetchJson: (url: string) => Promise<unknown>
  readonly runGhApi: () => Promise<unknown>
}

function parseArgs(args: readonly string[]): { readonly dryRun: boolean } {
  return { dryRun: args.includes("--dry-run") }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`)
  }
  return response.json()
}

async function defaultRunGhApi(): Promise<unknown> {
  const output = await $`gh api repos/${GITHUB_REPOSITORY}/releases --paginate`.text()
  return JSON.parse(output)
}

async function fetchNpmStat(packageName: string, fetchJson: StatsDeps["fetchJson"]): Promise<DownloadStat> {
  const data = NpmDownloadsSchema.parse(
    await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${packageName}`),
  )
  return {
    count: data.downloads,
    packageName,
    source: "npm",
  }
}

function readGitHubReleaseDownloadStat(releasesJson: unknown): DownloadStat {
  const releases = z.array(GitHubReleaseSchema).parse(releasesJson)
  const count = releases.reduce(
    (total, release) =>
      total + release.assets.reduce((assetTotal, asset) => assetTotal + asset.download_count, 0),
    0,
  )
  return {
    count,
    packageName: GITHUB_REPOSITORY,
    source: "github_release",
  }
}

export async function collectDownloadStats(deps: StatsDeps): Promise<readonly DownloadStat[]> {
  const npmStats = await Promise.all(
    NPM_PACKAGES.map((packageName) => fetchNpmStat(packageName, deps.fetchJson)),
  )
  return [...npmStats, readGitHubReleaseDownloadStat(await deps.runGhApi())]
}

export function createPostHogDownloadEvents(
  stats: readonly DownloadStat[],
  apiKey: string,
): readonly PostHogDownloadEvent[] {
  return stats.map((stat) => ({
    api_key: apiKey,
    event: "omo_download_stats",
    distinct_id: "download",
    properties: {
      $process_person_profile: false,
      count: stat.count,
      package_name: stat.packageName,
      source: stat.source,
    },
  }))
}

async function sendPostHogEvent(event: PostHogDownloadEvent): Promise<void> {
  const response = await fetch(POSTHOG_CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  })
  if (!response.ok) {
    throw new Error(`PostHog capture failed: ${response.status}`)
  }
}

export async function runStats(args: readonly string[], deps: StatsDeps): Promise<number> {
  const { dryRun } = parseArgs(args)
  const stats = await collectDownloadStats(deps)
  const events = createPostHogDownloadEvents(stats, process.env.POSTHOG_KEY ?? "dry-run")

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, events }, null, 2))
    return 0
  }

  const apiKey = process.env.POSTHOG_KEY
  if (!apiKey) {
    console.log("POSTHOG_KEY is not set; skipping download stats upload")
    return 0
  }

  for (const event of createPostHogDownloadEvents(stats, apiKey)) {
    await sendPostHogEvent(event)
  }
  console.log(`Sent ${events.length} download stats events`)
  return 0
}

if (import.meta.main) {
  const exitCode = await runStats(Bun.argv.slice(2), {
    fetchJson: defaultFetchJson,
    runGhApi: defaultRunGhApi,
  })
  process.exit(exitCode)
}
