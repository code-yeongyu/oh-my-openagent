import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { log } from "./logger"

const BLACKLIST_FILE = path.join(homedir(), ".cache", "opencode", "provider-blacklist.json")

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

// Synchronous version for reading blacklist (used in agent factories)
function readBlacklistSync(): BlacklistData {
  try {
    const content = fs.readFileSync(BLACKLIST_FILE, "utf-8")
    return JSON.parse(content)
  } catch {
    return { providers: {}, updatedAt: Date.now() }
  }
}

// Async version for backward compatibility
async function readBlacklist(): Promise<BlacklistData> {
  return readBlacklistSync()
}

function writeBlacklistSync(data: BlacklistData): void {
  try {
    fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true })
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    log("[global-blacklist] Failed to write blacklist", { error: String(error) })
  }
}

// Async version for backward compatibility
async function writeBlacklist(data: BlacklistData): Promise<void> {
  writeBlacklistSync(data)
}

export async function blacklistProvider(
  providerID: string,
  cooldownSeconds: number,
  reason: string = "Rate limit exceeded"
): Promise<void> {
  const blacklist = await readBlacklist()
  const now = Date.now()
  
  blacklist.providers[providerID] = {
    providerID,
    blacklistedAt: now,
    reason,
    expiresAt: now + (cooldownSeconds * 1000),
  }
  blacklist.updatedAt = now
  
  await writeBlacklist(blacklist)
  log("[global-blacklist] Provider blacklisted", {
    provider: providerID,
    cooldownSeconds,
    reason,
    expiresAt: new Date(blacklist.providers[providerID].expiresAt).toISOString(),
  })
}

// Synchronous version for agent factories and other sync contexts
export function isProviderBlacklistedSync(providerID: string): boolean {
  const blacklist = readBlacklistSync()
  const entry = blacklist.providers[providerID]
  
  if (!entry) return false
  
  const now = Date.now()
  if (now >= entry.expiresAt) {
    // Clean up expired entry
    delete blacklist.providers[providerID]
    blacklist.updatedAt = now
    try {
      writeBlacklistSync(blacklist)
    } catch {
      // Ignore write errors in sync context
    }
    return false
  }
  
  return true
}

// Async version for backward compatibility
export async function isProviderBlacklisted(providerID: string): Promise<boolean> {
  return isProviderBlacklistedSync(providerID)
}

export async function getBlacklistedProviders(): Promise<string[]> {
  const blacklist = await readBlacklist()
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
    await writeBlacklist(blacklist)
  }
  
  return activeProviders
}

export async function clearBlacklist(): Promise<void> {
  await writeBlacklist({ providers: {}, updatedAt: Date.now() })
  log("[global-blacklist] Blacklist cleared")
}
