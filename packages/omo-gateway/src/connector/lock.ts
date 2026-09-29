// The connector lock: one listener per (platform, account) per machine.
//
// `<agentDir>/gateway/connectors/<platform>-<account>.lock` holds the holder's pid, its process
// start identity and a per-acquisition nonce. The file is created with link(2) from a fully
// written temp file, so a reader never sees a torn record. A lock is stale only when its pid is
// dead or the pid now belongs to a different process (start identity of the same scheme differs);
// an unreadable pid (another uid) or an identity that cannot be compared keeps the lock held, so a
// live connector is never displaced.

import { randomBytes } from "node:crypto"
import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from "@oh-my-opencode/memory-core/fs"
import { dirname, join } from "node:path"
import {
  getPidLiveness,
  getProcessStartIdentity,
  startIdentitiesConflict,
  type ProcessLiveness,
} from "@oh-my-opencode/memory-core/process-identity"

export type ConnectorLockRecord = {
  pid: number
  /** process start identity (`<scheme>:<value>`), null when the platform cannot tell */
  pid_start: string | null
  /** unique per acquisition: release and reaping compare it, never the pid alone */
  nonce: string
  platform: string
  account_id: string
  scope: string
  started_at: string
}

/** How the lock asks the OS about a holder; injected by tests. */
export type LockProbe = {
  liveness(pid: number): ProcessLiveness
  startIdentity(pid: number): Promise<string | null>
}

export const processLockProbe: LockProbe = {
  liveness: getPidLiveness,
  startIdentity: getProcessStartIdentity,
}

export type HeldConnectorLock = {
  readonly path: string
  readonly record: ConnectorLockRecord
  /** the holder this acquisition displaced, when it took over a stale or corrupt lock */
  readonly tookOver: { pid: number | null; reason: "dead" | "start_mismatch" | "corrupt" } | null
  release(): Promise<void>
}

export type AcquireResult =
  | { kind: "acquired"; lock: HeldConnectorLock }
  | { kind: "held"; holder: ConnectorLockRecord }

const ACCOUNT_SAFE = /^[A-Za-z0-9._-]+$/
const ACQUIRE_ATTEMPTS = 8

export function connectorsDir(agentDir: string): string {
  return join(agentDir, "gateway", "connectors")
}

/** `<platform>-<account>`: the file stem every per-connector file shares. */
export function connectorName(platform: string, account_id: string): string {
  if (!ACCOUNT_SAFE.test(platform) || !ACCOUNT_SAFE.test(account_id) || account_id.startsWith(".")) {
    throw new Error(`connector account ${platform}:${account_id} is not a safe file name`)
  }
  return `${platform}-${account_id}`
}

export function connectorLockPath(agentDir: string, platform: string, account_id: string): string {
  return join(connectorsDir(agentDir), `${connectorName(platform, account_id)}.lock`)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function unlinkQuietly(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

/** Write `text` to `path` through a same-directory temp file and rename: readers see old or new, never half. */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await writeFile(temp, text, { mode: 0o600, flush: true })
    await rename(temp, path)
  } catch (error) {
    await unlinkQuietly(temp)
    throw error
  }
}

/**
 * Remove temp files a killed holder left mid-write (`<name>.presence.json.<pid>.<hex>.tmp`, cursor
 * likewise). Only the lock holder writes those files, so the caller must hold the lock; lock temps
 * of concurrent starters are never touched.
 */
export async function sweepOrphanTemps(agentDir: string, platform: string, account_id: string): Promise<string[]> {
  const name = connectorName(platform, account_id)
  const owned = [`${name}.presence.json.`, `${name}.cursor.json.`, `${name}.shadow-cursor.json.`]
  const removed: string[] = []
  for (const entry of await readdir(connectorsDir(agentDir))) {
    if (!entry.endsWith(".tmp") || !owned.some((prefix) => entry.startsWith(prefix))) continue
    await unlinkQuietly(join(connectorsDir(agentDir), entry))
    removed.push(entry)
  }
  return removed
}

type ReadLock = { kind: "missing" } | { kind: "record"; record: ConnectorLockRecord; raw: string } | { kind: "corrupt"; raw: string }

function parseRecord(raw: string): ConnectorLockRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== "object") return null
  const field = (name: string): unknown => Reflect.get(value, name)
  const pid = field("pid")
  const pidStart = field("pid_start")
  const nonce = field("nonce")
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null
  if (typeof nonce !== "string" || nonce === "") return null
  if (pidStart !== null && typeof pidStart !== "string") return null
  const text = (name: string): string => {
    const entry = field(name)
    return typeof entry === "string" ? entry : ""
  }
  return {
    pid,
    pid_start: pidStart,
    nonce,
    platform: text("platform"),
    account_id: text("account_id"),
    scope: text("scope"),
    started_at: text("started_at"),
  }
}

async function readLockFile(path: string): Promise<ReadLock> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" }
    throw error
  }
  const record = parseRecord(raw)
  return record === null ? { kind: "corrupt", raw } : { kind: "record", record, raw }
}

/** Why a recorded holder no longer holds the lock, or null while it is (or may be) alive. */
export async function staleReason(
  record: ConnectorLockRecord,
  probe: LockProbe = processLockProbe,
): Promise<"dead" | "start_mismatch" | null> {
  if (probe.liveness(record.pid) === "dead") return "dead"
  if (record.pid_start === null) return null
  const current = await probe.startIdentity(record.pid)
  if (current === null) return null
  return startIdentitiesConflict(record.pid_start, current) ? "start_mismatch" : null
}

/** The current holder of a connector lock and whether it is alive; null when no lock file exists. */
export async function readConnectorLock(
  path: string,
  probe: LockProbe = processLockProbe,
): Promise<{ record: ConnectorLockRecord; live: boolean } | null> {
  const read = await readLockFile(path)
  if (read.kind !== "record") return null
  return { record: read.record, live: (await staleReason(read.record, probe)) === null }
}

/**
 * Take the connector lock, or report its live holder. A stale lock is taken over by renaming it
 * aside and checking the renamed file is the stale record just read: when two starters race for
 * one stale lock, the loser renames the winner's fresh lock, sees a different nonce and links it
 * back, then finds that winner alive and reports it as the holder.
 */
export async function acquireConnectorLock(input: {
  path: string
  platform: string
  account_id: string
  scope: string
  probe?: LockProbe
  now?: () => Date
}): Promise<AcquireResult> {
  const probe = input.probe ?? processLockProbe
  const path = input.path
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const record: ConnectorLockRecord = {
    pid: process.pid,
    pid_start: await probe.startIdentity(process.pid),
    nonce: randomBytes(12).toString("hex"),
    platform: input.platform,
    account_id: input.account_id,
    scope: input.scope,
    started_at: (input.now?.() ?? new Date()).toISOString(),
  }
  const text = `${JSON.stringify(record)}\n`
  let tookOver: HeldConnectorLock["tookOver"] = null

  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    const temp = `${path}.${record.nonce}.tmp`
    await writeFile(temp, text, { mode: 0o600, flush: true })
    try {
      await link(temp, path)
      await unlinkQuietly(temp)
      return { kind: "acquired", lock: heldLock(path, record, tookOver) }
    } catch (error) {
      await unlinkQuietly(temp)
      if (errorCode(error) !== "EEXIST") throw error
    }

    const current = await readLockFile(path)
    if (current.kind === "missing") continue
    let reason: "dead" | "start_mismatch" | "corrupt"
    if (current.kind === "record") {
      const stale = await staleReason(current.record, probe)
      if (stale === null) return { kind: "held", holder: current.record }
      reason = stale
    } else {
      reason = "corrupt"
    }

    const reaped = `${path}.${record.nonce}.reap`
    try {
      await rename(path, reaped)
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      throw error
    }
    const moved = await readLockFile(reaped)
    const sameFile = moved.kind !== "missing" && moved.raw === current.raw
    if (sameFile) {
      await unlinkQuietly(reaped)
      tookOver = { pid: current.kind === "record" ? current.record.pid : null, reason }
      continue
    }
    // Lost the race: the file renamed aside is a fresh lock another starter just created. Put it back.
    try {
      await link(reaped, path)
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
    }
    await unlinkQuietly(reaped)
  }
  throw new Error(`could not take the connector lock ${path} after ${ACQUIRE_ATTEMPTS} attempts`)
}

function heldLock(path: string, record: ConnectorLockRecord, tookOver: HeldConnectorLock["tookOver"]): HeldConnectorLock {
  let released = false
  return {
    path,
    record,
    tookOver,
    async release() {
      if (released) return
      released = true
      const current = await readLockFile(path)
      if (current.kind === "record" && current.record.nonce === record.nonce) await unlinkQuietly(path)
    },
  }
}
