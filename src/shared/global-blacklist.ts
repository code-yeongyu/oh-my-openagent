import * as fs from "fs"
import * as path from "path"
import { log } from "./logger"
import { getOpenCodeCacheDir } from "./data-path"

// Allow tests to override the blacklist file path via environment variable
const BLACKLIST_FILE = process.env.OHMYOPENCODE_BLACKLIST_FILE 
  || path.join(getOpenCodeCacheDir(), "provider-blacklist.json")

export interface BlacklistEntry {
  providerID: string
  blacklistedAt: number
  reason: string
  expiresAt: number
}

export interface BlacklistData {
  providers: Record<string, BlacklistEntry>
  updatedAt: number
}

/**
 * Read blacklist from disk.
 * NOTE: Uses synchronous reads intentionally - this is a bug fix for race conditions.
 * Async reads caused race conditions where multiple concurrent checks would all see
 * the provider as not blacklisted before any could write the blacklist update.
 * Synchronous reads ensure consistency across the event loop tick.
 */
function readBlacklist(): BlacklistData {
  try {
    const content = fs.readFileSync(BLACKLIST_FILE, "utf-8")
    return JSON.parse(content)
  } catch {
    return { providers: {}, updatedAt: Date.now() }
  }
}

function writeBlacklist(data: BlacklistData): void {
  try {
    fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true })
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    log("[global-blacklist] Failed to write blacklist", { error: String(error) })
  }
}

export function blacklistProvider(
  providerID: string,
  cooldownSeconds: number,
  reason: string = "Rate limit exceeded"
): void {
  const blacklist = readBlacklist()
  const now = Date.now()
  
  blacklist.providers[providerID] = {
    providerID,
    blacklistedAt: now,
    reason,
    expiresAt: now + (cooldownSeconds * 1000),
  }
  blacklist.updatedAt = now
  
  writeBlacklist(blacklist)
  log("[global-blacklist] Provider blacklisted", {
    provider: providerID,
    cooldownSeconds,
    reason,
    expiresAt: new Date(blacklist.providers[providerID].expiresAt).toISOString(),
  })
}

export function isProviderBlacklisted(providerID: string): boolean {
  const blacklist = readBlacklist()
  const entry = blacklist.providers[providerID]
  
  if (!entry) return false
  
  const now = Date.now()
  if (now >= entry.expiresAt) {
    // Clean up expired entry
    delete blacklist.providers[providerID]
    blacklist.updatedAt = now
    try {
      writeBlacklist(blacklist)
    } catch {
      // Ignore write errors
    }
    return false
  }
  
  return true
}

export function getBlacklistedProviders(): string[] {
  const blacklist = readBlacklist()
  const now = Date.now()
  
  const activeProviders: string[] = []
  const expiredProviders: string[] = []
  
  for (const [providerID, entry] of Object.entries(blacklist.providers)) {
    if (now >= entry.expiresAt) {
      expiredProviders.push(providerID)
    } else {
      activeProviders.push(providerID)
    }
  }
  
  if (expiredProviders.length > 0) {
    for (const providerID of expiredProviders) {
      delete blacklist.providers[providerID]
    }
    blacklist.updatedAt = now
    try {
      writeBlacklist(blacklist)
    } catch {
      // Ignore write errors
    }
  }
  
  return activeProviders
}

export function clearBlacklist(): void {
  writeBlacklist({ providers: {}, updatedAt: Date.now() })
  log("[global-blacklist] Blacklist cleared")
}
