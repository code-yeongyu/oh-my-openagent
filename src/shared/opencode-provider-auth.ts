import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

import { getDataDir } from "./data-path"
import { log } from "./logger"

/**
 * Reads OpenCode's auth.json to detect the auth type used by a provider.
 *
 * OpenCode stores auth credentials at `<dataDir>/opencode/auth.json` in the
 * shape `{ [providerID]: { type: "oauth" | "api" | "wellknown", ... } }`.
 *
 * The file is read with mtime-based caching so we do not stat/parse it on
 * every chat.params invocation.
 */

type AuthRecord = {
  type?: unknown
}

type AuthCacheEntry = {
  mtimeMs: number
  map: Map<string, string>
}

let cached: AuthCacheEntry | null = null

function getAuthFilePath(): string {
  return path.join(getDataDir(), "opencode", "auth.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function loadAuthMap(): Map<string, string> {
  const filePath = getAuthFilePath()

  let mtimeMs: number
  try {
    mtimeMs = statSync(filePath).mtimeMs
  } catch {
    cached = null
    return new Map()
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.map
  }

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    const map = new Map<string, string>()
    if (isRecord(parsed)) {
      for (const [providerID, entry] of Object.entries(parsed)) {
        if (!isRecord(entry)) continue
        const type = (entry as AuthRecord).type
        if (typeof type === "string") {
          map.set(providerID, type)
        }
      }
    }
    cached = { mtimeMs, map }
    return map
  } catch (error) {
    log("[opencode-provider-auth] Failed to read auth.json", {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }
}

export function getProviderAuthType(providerID: string): string | undefined {
  return loadAuthMap().get(providerID)
}

export function isProviderUsingOAuth(providerID: string): boolean {
  return getProviderAuthType(providerID) === "oauth"
}

export function _resetProviderAuthCacheForTesting(): void {
  cached = null
}
