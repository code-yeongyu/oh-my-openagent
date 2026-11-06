import { randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveOtlpEndpoint } from "@oh-my-opencode/telemetry-core/otlp"
import type { TelemetryEnv } from "@oh-my-opencode/telemetry-core"

// A settled refusal, including invalidation, lasts until process exit. Parallel starts share one request.
const keys = new Map<string, { readonly endpoint: string; readonly pending: Promise<string | null> }>()
// Fits inside the adapter's 500 ms OTLP start budget.
const REGISTRATION_TIMEOUT_MS = 400
const DEFAULT_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1_000

function cachePath(root: string): string {
  return join(root, "omo-senpi", "otlp-ingest-key.json")
}

function validKey(key: unknown, hash: string): key is string {
  return typeof key === "string" && key.startsWith(`v1.omo-senpi.${hash}.`)
    && /^v1\.omo-senpi\.[a-f0-9]{64}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(key)
}

function readCache(path: string): { endpoint?: unknown; key?: unknown; notBefore?: unknown } {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    return typeof value === "object" && value !== null ? value : {}
  } catch {
    return {}
  }
}

function writeCache(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Runs only behind the adapter's consent/env gate; no errors or credentials reach diagnostics. */
export async function resolveInstallIngestKey(input: {
  readonly root: string
  readonly env: TelemetryEnv
  readonly hash: string
  readonly consent: () => boolean
}): Promise<string | null> {
  const path = cachePath(input.root)
  if (!/^[a-f0-9]{64}$/u.test(input.hash)) return null
  let endpoint: string
  try {
    const base = new URL(resolveOtlpEndpoint(input.env))
    endpoint = `${base.origin}${base.pathname.replace(/\/+$/u, "")}`
  } catch { return null }
  let entry = keys.get(path)
  if (entry === undefined) {
    const pending = (async () => {
      const cached = readCache(path)
      if (cached.endpoint === endpoint) {
        if (validKey(cached.key, input.hash)) {
          chmodSync(path, 0o600)
          return cached.key
        }
        if (typeof cached.notBefore === "number" && cached.notBefore > Date.now()) return null
      }
      if (!input.consent()) return null
      const response = await fetch(`${endpoint}/v1/register`, {
        method: "POST", redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product: "omo-senpi", install_hash: input.hash }),
        signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
      })
      if (!input.consent()) return null
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get("retry-after")
        const seconds = retryAfter === null || retryAfter.trim() === "" ? NaN : Number(retryAfter)
        const at = Number.isFinite(seconds) ? Date.now() + seconds * 1_000 : Date.parse(retryAfter ?? "")
        const now = Date.now()
        const notBefore = Math.min(now + MAX_BACKOFF_MS, Math.max(now + DEFAULT_BACKOFF_MS, Number.isFinite(at) ? at : 0))
        writeCache(path, { endpoint, notBefore })
        return null
      }
      if (response.status !== 200) return null
      const value: unknown = await response.json()
      if (typeof value !== "object" || value === null || !("key" in value) || !validKey(value.key, input.hash)) return null
      if (!input.consent()) return null
      writeCache(path, { endpoint, key: value.key })
      return value.key
    })().catch(() => null)
    entry = { endpoint, pending }
    keys.set(path, entry)
  }
  if (entry.endpoint !== endpoint) return null
  const key = await entry.pending
  return validKey(key, input.hash) ? key : null
}

/** Do not delete a replacement another process has already registered. Never re-register in this run. */
export function invalidateInstallIngestKey(root: string, key: string): void {
  const path = cachePath(root)
  keys.set(path, { endpoint: "", pending: Promise.resolve(null) })
  try {
    if (readCache(path).key === key) rmSync(path, { force: true })
  } catch {
    // A read-only cache cannot be repaired by telemetry; leave it for a later run.
    return
  }
}
