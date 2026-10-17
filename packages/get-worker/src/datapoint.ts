import type { Env } from "./env"

export type RequestKind = "binary" | "checksums" | "engine" | "script" | "channel"
export type ServedFrom = "r2" | "cache" | "github" | "npm" | "worker"

export interface DownloadEvent {
  readonly kind: RequestKind
  readonly source: ServedFrom
  readonly version: string
  readonly asset: string
  readonly country: string
  readonly qa: boolean
}

// Column order is the rollup's contract: blob1 kind, blob2 source, blob3 version, blob4 asset, blob5 country, blob6 "qa" for tagged QA installs.
export function recordDownload(env: Env, event: DownloadEvent): void {
  env.DOWNLOADS.writeDataPoint({
    blobs: [event.kind, event.source, event.version, event.asset, event.country, event.qa ? "qa" : ""],
    doubles: [1],
    indexes: [event.kind],
  })
}

export function isQaInstall(request: Request): boolean {
  return /\bomo-install-qa\b/.test(request.headers.get("User-Agent") ?? "")
}

export function requestCountry(request: Request): string {
  const country = request.cf?.country
  return typeof country === "string" ? country : "XX"
}
