import type { PoolEntry } from "./pool-schema"
import { getVendoredEntries } from "./vendored-pool-loader"
import { buildSecChUa } from "./sec-ch-ua-builder"
import { localeToTimezone } from "./locale-timezone"
import { pickViewportFor } from "./viewport-presets"

export type FingerprintFamily = {
  readonly userAgent: string
  readonly secChUa: string
  readonly secChUaMobile: "?0" | "?1"
  readonly secChUaPlatform: string
  readonly secChUaFullVersionList: string
  readonly acceptLanguage: string
  readonly viewport: { readonly width: number; readonly height: number }
  readonly timezone: string
  readonly locale: string
  readonly platform: "MacIntel" | "Win32" | "Linux x86_64" | "iPhone" | "iPad" | "Android"
  readonly hardwareConcurrency: number
  readonly browser: PoolEntry["browser"]
  readonly os: PoolEntry["os"]
  readonly device: PoolEntry["type"]
}

export type CreateFingerprintFamilyOptions = {
  browser?: PoolEntry["browser"]
  os?: PoolEntry["os"]
  device?: PoolEntry["type"]
  locale?: string
  source?: "vendored" | "intoli" | "auto"
  seed?: number
}

const DEFAULT_LOCALE = "en-US"
const DEFAULT_TIMEZONE = "America/New_York"

export function createFingerprintFamily(opts: CreateFingerprintFamilyOptions = {}): FingerprintFamily {
  const entry = pickEntry(opts)
  const locale = opts.locale ?? DEFAULT_LOCALE
  const timezone = localeToTimezone(locale) ?? DEFAULT_TIMEZONE
  const viewport = pickViewportFor(entry.type, opts.seed)
  const sec = buildSecChUa(entry.ua)

  const family: FingerprintFamily = {
    userAgent: entry.ua,
    secChUa: sec?.secChUa ?? "",
    secChUaMobile: sec?.secChUaMobile ?? (entry.type === "mobile" ? "?1" : "?0"),
    secChUaPlatform: sec?.secChUaPlatform ?? `"${platformLabel(entry.os)}"`,
    secChUaFullVersionList: sec?.secChUaFullVersionList ?? "",
    acceptLanguage: buildAcceptLanguage(locale),
    viewport: { width: viewport.width, height: viewport.height },
    timezone,
    locale,
    platform: navigatorPlatform(entry.os),
    hardwareConcurrency: hardwareConcurrencyFor(entry.os, entry.type),
    browser: entry.browser,
    os: entry.os,
    device: entry.type,
  }
  return Object.freeze(family)
}

function pickEntry(opts: CreateFingerprintFamilyOptions): PoolEntry {
  const filter: Partial<Pick<PoolEntry, "browser" | "os" | "type">> = {}
  if (opts.browser) filter.browser = opts.browser
  if (opts.os) filter.os = opts.os
  if (opts.device) filter.type = opts.device

  const candidates = getVendoredEntries(filter)
  if (candidates.length === 0) {
    const fallback = getVendoredEntries({})
    if (fallback.length === 0) {
      throw new Error("FingerprintFamily: vendored pool empty")
    }
    return fallback[((opts.seed ?? 0) % fallback.length + fallback.length) % fallback.length]!
  }
  return candidates[((opts.seed ?? 0) % candidates.length + candidates.length) % candidates.length]!
}

function platformLabel(os: PoolEntry["os"]): string {
  switch (os) {
    case "windows": return "Windows"
    case "macos": return "macOS"
    case "linux": return "Linux"
    case "ios": return "iOS"
    case "android": return "Android"
  }
}

function navigatorPlatform(os: PoolEntry["os"]): FingerprintFamily["platform"] {
  switch (os) {
    case "windows": return "Win32"
    case "macos": return "MacIntel"
    case "linux": return "Linux x86_64"
    case "ios": return "iPhone"
    case "android": return "Android"
  }
}

function hardwareConcurrencyFor(os: PoolEntry["os"], type: PoolEntry["type"]): number {
  if (type === "mobile" || type === "tablet") return os === "ios" ? 6 : 8
  if (os === "macos") return 10
  if (os === "windows") return 8
  return 8
}

function buildAcceptLanguage(locale: string): string {
  const primary = locale
  const family = locale.split("-")[0] ?? "en"
  if (primary.toLowerCase() === family.toLowerCase()) {
    return `${primary},en;q=0.9`
  }
  if (family === "en") {
    return `${primary},en;q=0.9`
  }
  return `${primary},${family};q=0.9,en;q=0.8`
}
