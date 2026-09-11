import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { getOmoNativeStateDir } from "../telemetry/product-identity"
import { COOLDOWN_DAYS, MS_PER_DAY } from "./constants"
import { gitCommonDirRealpath } from "./git-helpers"

export interface InitDeepSnapshotV1 {
  commitSha: string
  fileCount: number
  loc: number
  timestamp: number
  mode: "local" | "committed"
}

export type SnapshotReadResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; snapshot: InitDeepSnapshotV1 }

const ADVISOR_STATE_DIR = "init-deep-advisor-state"
const GLOBAL_DECLINE_FILE = "init-deep-advisor-declined-global"
const PROJECT_DECLINE_DIR = "init-deep-advisor-declined-projects"
const COOLDOWN_DIR = "init-deep-advisor-cooldowns"
const PROPOSAL_DIR = "init-deep-advisor-proposals"
const SNAPSHOT_RELATIVE_PATH = join(".omo", "init-deep.json")

export function getAdvisorStateDir(env?: Parameters<typeof getOmoNativeStateDir>[0]): string {
  return join(getOmoNativeStateDir(env), ADVISOR_STATE_DIR)
}

export function repoHash(root: string): string {
  return createHash("sha256").update(gitCommonDirRealpath(root)).digest("hex")
}

export function writeGlobalDecline(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true })
  writeAtomic(join(stateDir, GLOBAL_DECLINE_FILE), JSON.stringify({ declinedAt: Date.now() }))
}

export function isGloballyDeclined(stateDir: string): boolean {
  try {
    return existsSync(join(stateDir, GLOBAL_DECLINE_FILE))
  } catch {
    return false
  }
}

export function writeProjectDecline(stateDir: string, repoHash: string): void {
  const dir = join(stateDir, PROJECT_DECLINE_DIR)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, repoHash), JSON.stringify({ declinedAt: Date.now() }))
}

export function isProjectDeclined(stateDir: string, repoHash: string): boolean {
  try {
    return existsSync(join(stateDir, PROJECT_DECLINE_DIR, repoHash))
  } catch {
    return false
  }
}

export function writeCooldown(stateDir: string, repoHash: string, at: number): void {
  const dir = join(stateDir, COOLDOWN_DIR)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, repoHash), JSON.stringify({ until: at + COOLDOWN_DAYS * MS_PER_DAY }))
}

export function readCooldownUntil(stateDir: string, repoHash: string): number {
  const parsed = readJson(join(stateDir, COOLDOWN_DIR, repoHash))
  if (!isRecord(parsed)) return 0
  const until = parsed["until"]
  if (typeof until !== "number" || !Number.isFinite(until) || until < 0) return 0
  return until
}

export function isCoolingDown(stateDir: string, repoHash: string, now: number): boolean {
  return now < readCooldownUntil(stateDir, repoHash)
}

export function writeLastProposedHead(stateDir: string, repoHash: string, head: string): void {
  const dir = join(stateDir, PROPOSAL_DIR)
  mkdirSync(dir, { recursive: true })
  writeAtomic(
    join(dir, repoHash),
    JSON.stringify({ lastProposedHead: head, lastProposedAt: Date.now() }),
  )
}

export function readLastProposedHead(stateDir: string, repoHash: string): string | null {
  const parsed = readJson(join(stateDir, PROPOSAL_DIR, repoHash))
  if (!isRecord(parsed)) return null
  const head = parsed["lastProposedHead"]
  return typeof head === "string" ? head : null
}

export function readSnapshot(root: string): SnapshotReadResult {
  let raw: string
  try {
    raw = readFileSync(join(root, SNAPSHOT_RELATIVE_PATH), "utf8")
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "invalid" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "invalid" }
  }
  if (!isRecord(parsed)) return { kind: "invalid" }
  const { commitSha, fileCount, loc, timestamp, mode } = parsed
  if (typeof commitSha !== "string") return { kind: "invalid" }
  if (!isValidCount(fileCount) || !isValidCount(loc) || !isValidCount(timestamp)) {
    return { kind: "invalid" }
  }
  if (mode !== "local" && mode !== "committed") return { kind: "invalid" }
  return { kind: "valid", snapshot: { commitSha, fileCount, loc, timestamp, mode } }
}

function writeAtomic(dest: string, contents: string): void {
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, contents, { mode: 0o600 })
    renameSync(tmp, dest)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* already renamed or never created */
    }
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function isValidCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const code = error["code"]
  return typeof code === "string" ? code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
