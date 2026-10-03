import { detectInstall, type InstallClient } from "./install-targets"

export const DOWNLOAD_HOST = "get.omo.dev"
export const DEFAULT_DOWNLOAD_BASE_URL = `https://${DOWNLOAD_HOST}`
const DOCS_HOSTS: ReadonlySet<string> = new Set([DOWNLOAD_HOST, "omo.dev"])
const DEFAULT_LAUNCH_AT = "2026-11-10T00:00:00.000Z"
const FETCH_TIMEOUT_MS = 5000

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
    return url.protocol === "https:" && hosts.has(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

function parseInstaller(key: string, raw: unknown): DesktopInstaller | null {
  const platform = PLATFORM_KEYS[key]
  if (!platform || !isRecord(raw) || !isKind(raw.kind)) return null
  const url = onHost(raw.url, new Set([DOWNLOAD_HOST]))
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : ""
  if (url === null || !/^[0-9a-f]{64}$/.test(sha256)) return null
  const size =
    typeof raw.size === "number" && Number.isSafeInteger(raw.size) && raw.size > 0 ? raw.size : null
  const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  return { ...platform, kind: raw.kind, url, fileName, sha256, size }
}

function parseInstallers(platforms: unknown): DesktopInstaller[] {
  if (!isRecord(platforms)) return []
  return Object.entries(platforms).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).flatMap((raw) => parseInstaller(key, raw) ?? []),
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
  const installers = parseInstallers(raw.platforms)
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(raw.version) || installers.length === 0) {
    return { status: "unavailable" }
  }
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

export async function fetchChannelState(
  channel: DesktopChannel,
  { baseUrl, fetchImpl = fetch }: FetchChannelOptions,
): Promise<ChannelState> {
  try {
    const response = await fetchImpl(`${baseUrl}/${channel}/manifest.json`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.status === 404) return { status: "coming", launchAt: DEFAULT_LAUNCH_AT }
    if (!response.ok) return { status: "unavailable" }
    return parseChannelManifest(channel, await response.json())
  } catch {
    return { status: "unavailable" }
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
