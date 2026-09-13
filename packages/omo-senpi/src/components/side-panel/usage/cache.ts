import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { USAGE_CLAIM_MS, USAGE_TTL_MS } from "../constants"
import { asRecord, finiteNumber, nonEmptyString, optional } from "../guards"
import {
  USAGE_PROVIDER_KEYS,
  type PanelAccountState,
  type PanelUsageCacheFile,
  type PanelUsageEntry,
  type PanelUsageProviderKey,
  type PanelUsageWindow,
} from "./types"

/** What the poller needs to know about a provider before deciding to spend a request on it. */
export interface UsagePollTarget {
  readonly key: PanelUsageProviderKey
  /** The account that would serve this request right now, by name. */
  readonly account?: string
  /** Floor between reads, from `side_panel.usage_poll_seconds`. */
  readonly pollMs: number
}

/**
 * Which providers are worth a request right now.
 *
 * Three reasons to stay quiet, in the order they are checked: a shared backoff that has not
 * expired, numbers that are still fresh, and another session that announced the same fetch
 * moments ago. The account takes part in the first two checks - when the pool fails over, the
 * cached quota belongs to somebody else and has to be refetched at once, not in five minutes.
 */
export function providersDue(
  cache: PanelUsageCacheFile,
  targets: readonly UsagePollTarget[],
  now: number,
): readonly PanelUsageProviderKey[] {
  const due: PanelUsageProviderKey[] = []
  for (const target of targets) {
    const entry = cache[target.key]
    const sameAccount = entry?.account === target.account
    if (sameAccount && typeof entry?.retryAt === "number" && entry.retryAt > now) continue
    // The configured interval is a floor, not a way to ask faster than the provider's own
    // freshness window allows: whichever of the two is longer wins.
    const ttl = Math.max(USAGE_TTL_MS[target.key], target.pollMs)
    if (sameAccount && typeof entry?.updatedAt === "number" && now - entry.updatedAt < ttl) continue
    const claimedAt = cache.fetching?.[target.key]
    if (typeof claimedAt === "number" && now - claimedAt < USAGE_CLAIM_MS) continue
    due.push(target.key)
  }
  return due
}

/** Announce the fetches, so a sibling session skips them instead of asking the same question. */
export function claimProviders(
  cache: PanelUsageCacheFile,
  keys: readonly PanelUsageProviderKey[],
  now: number,
): PanelUsageCacheFile {
  const fetching: { -readonly [K in PanelUsageProviderKey]?: number } = { ...cache.fetching }
  for (const key of keys) fetching[key] = now
  return { ...entriesOf(cache), fetching }
}

/**
 * Fold results back in and release the claims.
 *
 * A failure never erases numbers that are already on screen: it is attached to the previous
 * entry as an error plus a retry deadline, so a rate-limited provider still shows its last
 * bars with their age instead of going blank.
 */
export function mergeUsageResults(
  cache: PanelUsageCacheFile,
  results: readonly { readonly key: PanelUsageProviderKey; readonly entry: PanelUsageEntry }[],
  claimed: readonly PanelUsageProviderKey[],
): PanelUsageCacheFile {
  const entries = entriesOf(cache)
  for (const { key, entry } of results) {
    const previous = cache[key]
    entries[key] =
      entry.error !== undefined && previous?.windows !== undefined
        ? { ...previous, error: entry.error, ...(entry.retryAt === undefined ? {} : { retryAt: entry.retryAt }) }
        : entry
  }
  const fetching: { -readonly [K in PanelUsageProviderKey]?: number } = { ...cache.fetching }
  for (const key of claimed) delete fetching[key]
  return { ...entries, fetching }
}

/**
 * One file per machine, outside every session directory: the quota it describes belongs to an
 * account, not to a session, and sharing it is what keeps N sessions from making N requests.
 */
export function usageCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache")
  return join(base, "omo-senpi", "side-panel-usage.json")
}

export function readUsageCache(path: string): PanelUsageCacheFile {
  try {
    return sanitizeUsageCache(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    // No cache yet, or a half-written one: the poller then treats everything as due.
    return {}
  }
}

/** Last writer wins. That is correct for a cache and keeps the write lock-free. */
export function writeUsageCache(path: string, cache: PanelUsageCacheFile): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(cache))
    renameSync(temporary, path)
    return true
  } catch {
    return false
  }
}

/**
 * The file is shared with other sessions and other versions of this component, so what comes
 * back off disk is validated rather than trusted: an unreadable field is dropped, and a
 * damaged entry costs one refetch instead of a broken frame.
 */
export function sanitizeUsageCache(value: unknown): PanelUsageCacheFile {
  const record = asRecord(value)
  if (record === undefined) return {}
  const entries: { -readonly [K in PanelUsageProviderKey]?: PanelUsageEntry } = {}
  for (const key of USAGE_PROVIDER_KEYS) {
    const entry = sanitizeEntry(record[key])
    if (entry !== undefined) entries[key] = entry
  }
  const fetchingRecord = asRecord(record["fetching"])
  const fetching: { -readonly [K in PanelUsageProviderKey]?: number } = {}
  for (const key of USAGE_PROVIDER_KEYS) {
    const claimedAt = fetchingRecord?.[key]
    if (typeof claimedAt === "number" && Number.isFinite(claimedAt)) fetching[key] = claimedAt
  }
  return { ...entries, fetching }
}

function sanitizeEntry(value: unknown): PanelUsageEntry | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const windows: PanelUsageWindow[] = []
  for (const item of Array.isArray(record["windows"]) ? record["windows"] : []) {
    const window = asRecord(item)
    const label = window?.["label"]
    const percent = window?.["percent"]
    if (typeof label !== "string" || typeof percent !== "number" || !Number.isFinite(percent)) continue
    windows.push({
      label,
      percent,
      ...optional("resetsAt", finiteNumber(window?.["resetsAt"])),
      ...optional("windowMs", finiteNumber(window?.["windowMs"])),
      ...(window?.["scoped"] === true ? { scoped: true } : {}),
    })
  }
  return {
    ...(windows.length > 0 ? { windows } : {}),
    ...optional("plan", nonEmptyString(record["plan"])),
    ...optional("account", nonEmptyString(record["account"])),
    ...optional("pinnedAccount", nonEmptyString(record["pinnedAccount"])),
    ...(isAccountState(record["accountState"]) ? { accountState: record["accountState"] } : {}),
    ...optional("updatedAt", finiteNumber(record["updatedAt"])),
    ...optional("error", nonEmptyString(record["error"])),
    ...optional("retryAt", finiteNumber(record["retryAt"])),
  }
}

/** All entries except the claim bookkeeping, as a mutable copy. */
function entriesOf(cache: PanelUsageCacheFile): { -readonly [K in PanelUsageProviderKey]?: PanelUsageEntry } {
  const entries: { -readonly [K in PanelUsageProviderKey]?: PanelUsageEntry } = {}
  for (const key of USAGE_PROVIDER_KEYS) {
    const entry = cache[key]
    if (entry !== undefined) entries[key] = entry
  }
  return entries
}

function isAccountState(value: unknown): value is PanelAccountState {
  return value === "ok" || value === "cooldown" || value === "stale"
}




