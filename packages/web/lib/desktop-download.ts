import { detectInstall, type InstallClient } from "./install-targets"

export const DOWNLOAD_HOST = "get.omo.dev"
export const DEFAULT_DOWNLOAD_BASE_URL = `https://${DOWNLOAD_HOST}`
const DOCS_HOSTS: ReadonlySet<string> = new Set([DOWNLOAD_HOST, "omo.dev"])
const DEFAULT_LAUNCH_AT = "2026-11-10T00:00:00.000Z"
const FETCH_TIMEOUT_MS = 5000

/**
 * The download page, its hero button, its sitemap entry and the /desktop redirect exist only when
 * the site was BUILT with OMO_WEB_DESKTOP_DOWNLOAD=1: next.config.ts inlines the value into every
 * bundle, so a Worker variable has no effect. Production deploys do not set it, so merging changes
 * nothing on omo.dev; launch = add it to the build step of web-deploy.yml and deploy.
 */
export function desktopDownloadEnabled(): boolean {
  return process.env.OMO_WEB_DESKTOP_DOWNLOAD === "1"
}

export type DesktopChannel = "stable" | "beta"
export type DesktopOs = "macos" | "windows" | "linux"
export type DesktopArch = "arm64" | "x64"
export type InstallerKind = "dmg" | "exe" | "deb" | "appimage"

export interface DesktopInstaller {
  readonly os: DesktopOs
  readonly arch: DesktopArch
  readonly kind: InstallerKind
  readonly url: string
  readonly fileName: string
  readonly sha256: string
  readonly size: number | null
}

export interface DesktopRelease {
  readonly channel: DesktopChannel
  readonly version: string
  readonly releasedAt: string | null
  readonly notesUrl: string | null
  readonly checksumsUrl: string
  readonly installers: readonly DesktopInstaller[]
}

export type ChannelState =
  | { readonly status: "ready"; readonly release: DesktopRelease }
  | { readonly status: "coming"; readonly launchAt: string }
  | { readonly status: "unavailable" }

const PLATFORM_KEYS: Readonly<Record<string, { os: DesktopOs; arch: DesktopArch }>> = {
  "mac-arm64": { os: "macos", arch: "arm64" },
  "mac-x64": { os: "macos", arch: "x64" },
  "win-x64": { os: "windows", arch: "x64" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "linux-x64": { os: "linux", arch: "x64" },
}
const KIND_RANK: Readonly<Record<InstallerKind, number>> = { dmg: 0, exe: 0, deb: 1, appimage: 2 }
const OS_ORDER: readonly DesktopOs[] = ["macos", "windows", "linux"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isKind(value: unknown): value is InstallerKind {
  return typeof value === "string" && value in KIND_RANK
}

function onHost(value: unknown, hosts: ReadonlySet<string>): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    const plain = url.port === "" && url.username === "" && url.password === ""
    return url.protocol === "https:" && plain && hosts.has(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/** A plain installer file name: what `SHA256SUMS` lists and the verify commands can take unquoted. */
const FILE_NAME = /^[A-Za-z0-9._+-]+$/

/**
 * An installer of this release: on the download host, inside the release's own folder
 * (`/<channel>/<version>/<file>`), with a plain file name and a well-formed SHA-256.
 */
function parseInstaller(folder: string, key: string, raw: unknown): DesktopInstaller | null {
  const platform = PLATFORM_KEYS[key]
  if (!platform || !isRecord(raw) || !isKind(raw.kind)) return null
  const url = onHost(raw.url, new Set([DOWNLOAD_HOST]))
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : ""
  if (url === null || !/^[0-9a-f]{64}$/.test(sha256)) return null
  const { pathname } = new URL(url)
  if (!pathname.startsWith(folder)) return null
  let fileName: string
  try {
    fileName = decodeURIComponent(pathname.slice(folder.length))
  } catch {
    return null
  }
  if (!FILE_NAME.test(fileName)) return null
  const size =
    typeof raw.size === "number" && Number.isSafeInteger(raw.size) && raw.size > 0 ? raw.size : null
  return { ...platform, kind: raw.kind, url, fileName, sha256, size }
}

function parseInstallers(folder: string, platforms: unknown): DesktopInstaller[] {
  if (!isRecord(platforms)) return []
  return Object.entries(platforms).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).flatMap(
      (raw) => parseInstaller(folder, key, raw) ?? [],
    ),
  )
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

export function parseChannelManifest(channel: DesktopChannel, raw: unknown): ChannelState {
  if (!isRecord(raw)) return { status: "unavailable" }
  if (typeof raw.version !== "string") {
    const launchAt = parseDate(raw.launchAt)
    return launchAt === null ? { status: "unavailable" } : { status: "coming", launchAt }
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(raw.version)) return { status: "unavailable" }
  const installers = parseInstallers(`/${channel}/${raw.version}/`, raw.platforms)
  if (installers.length === 0) return { status: "unavailable" }
  return {
    status: "ready",
    release: {
      channel,
      version: raw.version,
      releasedAt: parseDate(raw.date),
      notesUrl: onHost(raw.notesUrl, DOCS_HOSTS),
      checksumsUrl: `https://${DOWNLOAD_HOST}/${channel}/${raw.version}/SHA256SUMS`,
      installers,
    },
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface FetchChannelOptions {
  readonly baseUrl: string
  readonly fetchImpl?: FetchLike
}

/** Statuses the host answers for a channel it does not serve to the public yet (missing or gated). */
const NOT_PUBLIC_YET: ReadonlySet<number> = new Set([401, 403, 404])

/**
 * `<sha256>  <file name>` lines of a release's SHA256SUMS, keyed by file name; `null` when a name
 * appears twice, because then the file does not say which checksum is the release's.
 */
function parseSha256Sums(text: string): ReadonlyMap<string, string> | null {
  const sums = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())
    if (!match?.[1] || !match[2]) continue
    if (sums.has(match[2])) return null
    sums.set(match[2], match[1].toLowerCase())
  }
  return sums
}

async function fetchFromHost(
  fetchImpl: FetchLike,
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetchImpl(url, { headers: { Accept: accept }, cache: "no-store", signal })
}

/**
 * Reads a channel's manifest, then that release's SHA256SUMS, and offers only the installers whose
 * manifest SHA-256 equals their SHA256SUMS line: the checksum a visitor verifies against is the one
 * the release published, never a value only the manifest claims.
 */
export async function fetchChannelState(
  channel: DesktopChannel,
  { baseUrl, fetchImpl = fetch }: FetchChannelOptions,
): Promise<ChannelState> {
  // One deadline for both reads, so a hanging host delays the page by at most FETCH_TIMEOUT_MS.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  try {
    const response = await fetchFromHost(
      fetchImpl,
      `${baseUrl}/${channel}/manifest.json`,
      "application/json",
      signal,
    )
    if (NOT_PUBLIC_YET.has(response.status)) {
      return { status: "coming", launchAt: DEFAULT_LAUNCH_AT }
    }
    if (!response.ok) return { status: "unavailable" }
    const state = parseChannelManifest(channel, await response.json())
    if (state.status !== "ready") return state

    const sumsResponse = await fetchFromHost(
      fetchImpl,
      `${baseUrl}/${channel}/${state.release.version}/SHA256SUMS`,
      "text/plain",
      signal,
    )
    if (!sumsResponse.ok) return { status: "unavailable" }
    const sums = parseSha256Sums(await sumsResponse.text())
    if (sums === null) return { status: "unavailable" }
    const installers = state.release.installers.filter(
      (installer) => sums.get(installer.fileName) === installer.sha256,
    )
    if (installers.length === 0) return { status: "unavailable" }
    return { status: "ready", release: { ...state.release, installers } }
  } catch {
    return { status: "unavailable" }
  }
}

/** How long a ready or "coming" answer is reused before the host is asked again. */
export const DEFAULT_CHANNEL_CACHE_MS = 60_000

export interface ChannelReaderOptions extends FetchChannelOptions {
  readonly now?: () => number
  readonly cacheMs?: number
}

/**
 * Reads channel states through a short cache, so page views and crawlers within a minute share one
 * pair of requests to the download host. An unavailable answer is never kept: the next view retries.
 */
export function createChannelReader({
  now = Date.now,
  cacheMs = DEFAULT_CHANNEL_CACHE_MS,
  ...options
}: ChannelReaderOptions): (channel: DesktopChannel) => Promise<ChannelState> {
  const cache = new Map<DesktopChannel, { readonly state: ChannelState; readonly at: number }>()
  return async (channel) => {
    const hit = cache.get(channel)
    if (hit && now() - hit.at < cacheMs) return hit.state
    const state = await fetchChannelState(channel, options)
    if (state.status === "unavailable") cache.delete(channel)
    else cache.set(channel, { state, at: now() })
    return state
  }
}

export interface DesktopClient extends InstallClient {
  /** `architecture` from `navigator.userAgentData.getHighEntropyValues`: "arm" or "x86". */
  readonly architecture?: string
}

export interface DesktopVisitor {
  readonly os: DesktopOs | null
  readonly arch: DesktopArch | null
  readonly device: "computer" | "phone" | "unsupported"
}

function detectArch(client: DesktopClient, os: DesktopOs): DesktopArch | null {
  if (client.architecture === "arm") return "arm64"
  if (client.architecture === "x86") return "x64"
  if (os === "macos") return null
  const text = `${client.userAgent} ${client.platform ?? ""}`
  if (/arm64|aarch64/i.test(text)) return "arm64"
  if (/x86_64|x64|amd64|win64/i.test(text)) return "x64"
  return null
}

export function detectDesktopPlatform(client: DesktopClient): DesktopVisitor {
  const { os } = detectInstall(client)
  if (os === "ios" || os === "android" || client.mobile === true) {
    return { os: null, arch: null, device: "phone" }
  }
  if (os !== "macos" && os !== "windows" && os !== "linux") {
    return { os: null, arch: null, device: "unsupported" }
  }
  return { os, arch: detectArch(client, os), device: "computer" }
}

export interface InstallerChoice {
  readonly primary: DesktopInstaller | null
  /** True when the browser could not say which Mac CPU this is and Apple silicon was assumed. */
  readonly archAssumed: boolean
  readonly rest: readonly DesktopInstaller[]
}

function byPreference(a: DesktopInstaller, b: DesktopInstaller): number {
  return OS_ORDER.indexOf(a.os) - OS_ORDER.indexOf(b.os) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
}

/** The release's installers in the order the page lists them: by system, then preferred kind. */
export function listedInstallers(release: DesktopRelease): readonly DesktopInstaller[] {
  return [...release.installers].sort(byPreference)
}

export function chooseInstallers(
  release: DesktopRelease,
  visitor: DesktopVisitor,
): InstallerChoice {
  const sorted = [...release.installers].sort(byPreference)
  if (visitor.os === null) return { primary: null, archAssumed: false, rest: sorted }
  const mine = sorted.filter((installer) => installer.os === visitor.os)
  const wanted = visitor.arch ?? (visitor.os === "macos" ? "arm64" : "x64")
  let fits = mine.filter((installer) => installer.arch === wanted)
  if (fits.length === 0 && visitor.os !== "linux") {
    fits = mine.filter((installer) => installer.arch === "x64")
  }
  const primary = fits[0] ?? null
  const others = sorted.filter((installer) => installer !== primary)
  const rest = [
    ...others.filter((installer) => installer.os === visitor.os),
    ...others.filter((installer) => installer.os !== visitor.os),
  ]
  return { primary, archAssumed: visitor.os === "macos" && visitor.arch === null, rest }
}

export type PlatformKey = "mac-arm64" | "mac-x64" | "win-x64" | "linux-arm64" | "linux-x64"

export function platformKey(installer: Pick<DesktopInstaller, "os" | "arch">): PlatformKey {
  const prefix = installer.os === "macos" ? "mac" : installer.os === "windows" ? "win" : "linux"
  return `${prefix}-${installer.arch}` as PlatformKey
}

export function formatInstallerSize(bytes: number | null, locale: string): string {
  if (bytes === null) return ""
  const gigabytes = bytes >= 1_000_000_000
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: gigabytes ? 2 : 1 })
  return `${number.format(bytes / (gigabytes ? 1_000_000_000 : 1_000_000))} ${gigabytes ? "GB" : "MB"}`
}
