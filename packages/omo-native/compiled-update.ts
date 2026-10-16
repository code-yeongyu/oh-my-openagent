import { updateUsageAnswer } from "./bin/lib/update-args.js"

export const RELEASES_URL = "https://github.com/code-yeongyu/oh-my-openagent/releases"
const RELEASES_API = "https://api.github.com/repos/code-yeongyu/oh-my-openagent/releases?per_page=100"
const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/
const RELEASE_TARGET = /^(?:darwin|linux|windows)-(?:x64|arm64)(?:-musl)?(?:-baseline)?$/

export type FetchReleases = () => Promise<unknown>
export type CompiledUpdateResult = { readonly output: string; readonly exitCode: number; readonly stream?: "stdout" | "stderr" }

// omo-ai publishes betas as `5.0.0-0.beta.90` while the GitHub release is tagged `v5.0.0-beta.90`.
export function releaseVersionOf(omoAiVersion: string): string {
  return omoAiVersion.replace(/^(\d+\.\d+\.\d+)-0\.(.+)$/, "$1-$2")
}

export function releaseAssetName(releaseTarget: unknown, platform: NodeJS.Platform, arch: string): string {
  const flavor = typeof releaseTarget === "string" && RELEASE_TARGET.test(releaseTarget)
    ? releaseTarget
    : `${platform === "win32" ? "windows" : platform}-${arch}`
  return flavor.startsWith("windows-") ? `omo-${flavor}.exe` : `omo-${flavor}`
}

function readRelease(release: unknown): { readonly version: string; readonly assets: readonly string[] } | undefined {
  if (typeof release !== "object" || release === null || Reflect.get(release, "draft") === true) return undefined
  const tag = Reflect.get(release, "tag_name")
  const assets = Reflect.get(release, "assets")
  if (typeof tag !== "string" || !Array.isArray(assets)) throw new Error("GitHub release has no tag_name or assets")
  const version = tag.replace(/^v/, "")
  if (!RELEASE_VERSION.test(version)) return undefined
  return { version, assets: assets.map((asset) => (typeof asset === "object" && asset !== null ? String(Reflect.get(asset, "name")) : "")) }
}

/**
 * The newest release on the running build's channel that ships `asset`, or undefined when the running
 * version is already the newest. A stable build only moves to stable releases; a beta build follows
 * the newest release of either kind. GitHub's Latest badge is not used: it goes to betas too.
 */
export function pickUpdateVersion(currentVersion: string, releases: unknown, asset: string): string | undefined {
  if (!Array.isArray(releases)) throw new Error("GitHub releases payload is not an array")
  const stableOnly = !currentVersion.includes("-")
  let newest: string | undefined
  for (const entry of releases) {
    const release = readRelease(entry)
    if (release === undefined || !release.assets.includes(asset)) continue
    if (stableOnly && release.version.includes("-")) continue
    if (newest === undefined || Bun.semver.order(release.version, newest) > 0) newest = release.version
  }
  if (newest === undefined) throw new Error(`no ${stableOnly ? "stable " : ""}release ships ${asset}`)
  return Bun.semver.order(newest, currentVersion) > 0 ? newest : undefined
}

const posixQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const powershellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`

// Swap, never overwrite: writing over a running executable fails (ETXTBSY / Windows file lock).
export function replaceCommand(url: string, destination: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const [src, dest, old] = [url, destination, `${destination}.old`].map(powershellQuote)
    const next = powershellQuote(`${destination}.new`)
    return `curl.exe -fsSL ${src} -o ${next}; if ($?) { Move-Item -Force -LiteralPath ${dest} -Destination ${old}; Move-Item -LiteralPath ${next} -Destination ${dest} }`
  }
  const next = posixQuote(`${destination}.new`)
  return `curl -fsSL ${posixQuote(url)} -o ${next} && chmod +x ${next} && mv -f ${next} ${posixQuote(destination)}`
}

export const fetchGitHubReleases: FetchReleases = async () => {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "omo" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return response.json()
}

export async function compiledUpdate(options: {
  readonly omoAiVersion: string
  readonly releaseTarget: unknown
  readonly destination: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly fetchReleases: FetchReleases
  readonly args?: readonly string[]
}): Promise<CompiledUpdateResult> {
  const usage = options.args === undefined ? undefined : updateUsageAnswer(options.args)
  if (usage !== undefined) return { output: usage.text, exitCode: usage.exitCode, stream: usage.stream }
  const asset = releaseAssetName(options.releaseTarget, options.platform, options.arch)
  const current = releaseVersionOf(options.omoAiVersion)
  let target: string | undefined
  try {
    target = pickUpdateVersion(current, await options.fetchReleases(), asset)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { output: `omo update could not resolve a release (${reason}). Download ${asset} from ${RELEASES_URL}`, exitCode: 1 }
  }
  if (target === undefined) return { output: `omo ${current} is the newest ${current.includes("-") ? "beta" : "stable"} release`, exitCode: 0 }
  const command = replaceCommand(`${RELEASES_URL}/download/v${target}/${asset}`, options.destination, options.platform)
  return { output: `omo ${target} is available (running ${current}). Replace this binary with:\n${command}`, exitCode: 0 }
}
