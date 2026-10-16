import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { SummaryWindow } from "./session-summary-window"

/** Where the writing session read its consent: recovery re-reads consent for this scope before sending. */
export type ConsentScope = { readonly cwd?: string }

export type StoredRollup = {
  readonly v: 1
  readonly pid: number
  readonly sessionHash: string
  readonly sessionRole: string
  readonly nextSeq: number
  readonly window: SummaryWindow | null
  readonly updatedAt: number
  /** Consent at write time. Only a rollup marked `enabled` may ever be sent; files without it predate the mark. */
  readonly consent?: "enabled"
  /** Absent on files older than the scope; such a file cannot have its consent re-read and is never sent. */
  readonly scope?: ConsentScope
}

export type SummaryStore = {
  readonly read: (sessionHash: string) => StoredRollup | undefined
  readonly write: (rollup: Omit<StoredRollup, "v" | "pid" | "updatedAt" | "consent" | "scope"> & { readonly consent: "enabled"; readonly scope: ConsentScope; readonly updatedAt?: number }) => void
  readonly remove: (sessionHash: string) => void
  /** Claims every rollup whose owning process is gone; each is returned once across racing processes. */
  readonly claimOrphans: () => readonly StoredRollup[]
}

const FILE_SUFFIX = ".json"
export const ROLLUP_TTL_MS = 14 * 24 * 60 * 60_000
const TEMP_FILE = /\.(\d+)\.tmp$/
const CLAIM_FILE = /\.claimed-(\d+)$/
const SAFE_NAME = /^[A-Za-z0-9:_-]{1,128}$/

export function rollupDir(stateDir: string): string {
  return join(stateDir, "rollups")
}

export function createSummaryStore(input: {
  readonly stateDir: string
  readonly pid?: number
  readonly isAlive?: (pid: number) => boolean
  readonly now?: () => number
}): SummaryStore {
  const now = input.now ?? Date.now
  const dir = rollupDir(input.stateDir)
  const pid = input.pid ?? process.pid
  const isAlive = input.isAlive ?? processIsAlive
  const pathOf = (sessionHash: string) => join(dir, `${fileName(sessionHash)}${FILE_SUFFIX}`)

  return {
    read: (sessionHash) => parseRollup(readText(pathOf(sessionHash))),
    write(rollup) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const target = pathOf(rollup.sessionHash)
      const temp = `${target}.${pid}.tmp`
      writeFileSync(temp, JSON.stringify({ v: 1, pid, ...rollup, updatedAt: rollup.updatedAt ?? now() }), { mode: 0o600 })
      renameSync(temp, target)
    },
    remove: (sessionHash) => rmSync(pathOf(sessionHash), { force: true }),
    claimOrphans() {
      const claimed: StoredRollup[] = []
      for (const name of listNames(dir)) {
        const path = join(dir, name)
        const leftover = TEMP_FILE.exec(name) ?? CLAIM_FILE.exec(name)
        if (leftover !== null) {
          const owner = Number(leftover[1])
          if (owner !== pid && !isAlive(owner)) rmSync(path, { force: true })
          continue
        }
        if (!name.endsWith(FILE_SUFFIX)) continue
        const rollup = parseRollup(readText(path))
        if (rollup !== undefined && now() - rollup.updatedAt > ROLLUP_TTL_MS) {
          rmSync(path, { force: true })
          continue
        }
        if (rollup !== undefined && (rollup.pid === pid || isAlive(rollup.pid))) continue
        const claimPath = `${path}.claimed-${pid}`
        try {
          renameSync(path, claimPath)
        } catch {
          continue
        }
        const owned = parseRollup(readText(claimPath))
        rmSync(claimPath, { force: true })
        if (owned !== undefined) claimed.push(owned)
      }
      return claimed
    },
  }
}

function fileName(sessionHash: string): string {
  return SAFE_NAME.test(sessionHash) ? sessionHash.replaceAll(":", "_") : Buffer.from(sessionHash).toString("hex").slice(0, 128)
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function listNames(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function isWindowShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const shape = value as Record<string, unknown>
  return Array.isArray(shape["models"]) && Array.isArray(shape["totals"]) && typeof shape["sums"] === "object" && shape["sums"] !== null
}

function parseRollup(text: string | undefined): StoredRollup | undefined {
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Record<string, unknown>
    if (record["v"] !== 1 || typeof record["pid"] !== "number" || typeof record["sessionHash"] !== "string") return undefined
    if (typeof record["nextSeq"] !== "number" || typeof record["sessionRole"] !== "string" || typeof record["updatedAt"] !== "number") return undefined
    const window = record["window"]
    if (window !== null && !isWindowShape(window)) return undefined
    return value as StoredRollup
  } catch {
    return undefined
  }
}
