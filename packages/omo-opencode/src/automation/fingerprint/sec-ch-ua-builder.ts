export type SecChUaSet = {
  secChUa: string
  secChUaMobile: "?0" | "?1"
  secChUaPlatform: string
  secChUaFullVersionList: string
}

const NOT_A_BRAND_VERSION = "24"
const NOT_A_BRAND_FULL = "24.0.0.0"

type ParsedUa = {
  engine: "chromium" | "firefox" | "safari" | "unknown"
  brand: "chrome" | "edge"
  major: string
  full: string
  os: "windows" | "macos" | "linux" | "ios" | "android" | "unknown"
  isMobile: boolean
}

export function parseUserAgent(ua: string): ParsedUa {
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(ua)
  const os: ParsedUa["os"] =
    /Windows NT/.test(ua) ? "windows" :
    /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua) ? "macos" :
    /Linux x86_64|X11; Linux/.test(ua) && !/Android/.test(ua) ? "linux" :
    /Android/.test(ua) ? "android" :
    /iPhone|iPad|iPod/.test(ua) ? "ios" :
    "unknown"

  const edgeMatch = ua.match(/Edg(?:A|iOS)?\/(\d+(?:\.\d+){0,3})/)
  if (edgeMatch?.[1]) {
    return { engine: "chromium", brand: "edge", major: edgeMatch[1].split(".")[0]!, full: edgeMatch[1], os, isMobile }
  }
  const chromeMatch = ua.match(/(?:Chrome|CriOS)\/(\d+(?:\.\d+){0,3})/)
  if (chromeMatch?.[1]) {
    return { engine: "chromium", brand: "chrome", major: chromeMatch[1].split(".")[0]!, full: chromeMatch[1], os, isMobile }
  }
  if (/Firefox\//.test(ua)) {
    return { engine: "firefox", brand: "chrome", major: "0", full: "0", os, isMobile }
  }
  if (/Version\/[\d.]+ Safari/.test(ua)) {
    return { engine: "safari", brand: "chrome", major: "0", full: "0", os, isMobile }
  }
  return { engine: "unknown", brand: "chrome", major: "0", full: "0", os, isMobile }
}

export function buildSecChUa(ua: string): SecChUaSet | null {
  const parsed = parseUserAgent(ua)
  if (parsed.engine !== "chromium") return null

  const brands = parsed.brand === "edge"
    ? [
        { name: "Microsoft Edge", version: parsed.major, full: parsed.full },
        { name: "Chromium", version: parsed.major, full: parsed.full },
        { name: "Not_A Brand", version: NOT_A_BRAND_VERSION, full: NOT_A_BRAND_FULL },
      ]
    : [
        { name: "Chromium", version: parsed.major, full: parsed.full },
        { name: "Google Chrome", version: parsed.major, full: parsed.full },
        { name: "Not_A Brand", version: NOT_A_BRAND_VERSION, full: NOT_A_BRAND_FULL },
      ]

  const secChUa = brands.map((b) => `"${b.name}";v="${b.version}"`).join(", ")
  const secChUaFullVersionList = brands.map((b) => `"${b.name}";v="${b.full}"`).join(", ")
  const secChUaMobile = parsed.isMobile ? "?1" : "?0"
  const secChUaPlatform = `"${platformLabel(parsed.os)}"`

  return { secChUa, secChUaMobile, secChUaPlatform, secChUaFullVersionList }
}

function platformLabel(os: ParsedUa["os"]): string {
  switch (os) {
    case "windows": return "Windows"
    case "macos": return "macOS"
    case "linux": return "Linux"
    case "ios": return "iOS"
    case "android": return "Android"
    default: return "Unknown"
  }
}
