import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

export const COOLDOWN_DAYS = 7
const MS_PER_DAY = 86_400_000

// The claim keeps its historical name: a marker an older engine wrote (version 1, no `claimedAt`) means completed.
export const ONBOARDING_MARKER = "onboarding-completed"
export const COMPLETION_MARKER = "onboarding-completion"
const GLOBAL_DECLINE_FILE = "onboarding-declined-global"
const PROJECT_DECLINE_DIR = "onboarding-declined-projects"
const COOLDOWN_DIR = "onboarding-cooldowns"

export function claimOnboarding(stateDir: string): boolean {
  try {
    mkdirSync(stateDir, { recursive: true })
  } catch {
    return false
  }
  if (existsSync(join(stateDir, COMPLETION_MARKER))) return false
  try {
    writeFileSync(
      join(stateDir, ONBOARDING_MARKER),
      JSON.stringify({ claimedAt: new Date().toISOString(), version: 2 }),
      { flag: "wx", mode: 0o600 },
    )
    return true
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    return false
  }
}

/** Records that onboarding finished (TUI turn or RPC client); the first completion's time is kept. */
export function completeOnboarding(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true })
  try {
    writeFileSync(
      join(stateDir, COMPLETION_MARKER),
      JSON.stringify({ completedAt: new Date().toISOString(), version: 2 }),
      { flag: "wx", mode: 0o600 },
    )
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
  }
}

/** Claimed or completed: either way no other process starts onboarding. */
export function isOnboardingComplete(stateDir: string): boolean {
  try {
    return existsSync(join(stateDir, ONBOARDING_MARKER)) || existsSync(join(stateDir, COMPLETION_MARKER))
  } catch {
    return false
  }
}

/** When onboarding was completed, or null when it is not (a held claim is not completion). */
export function readOnboardingCompletedAt(stateDir: string): string | null {
  return readMarkerTime(stateDir, COMPLETION_MARKER) ?? readLegacyCompletion(stateDir)
}

/** A recorded completion exists; a held claim (live or not) is judged by the sidecar's `claim-owner.ts`. */
export function isOnboardingCompletionRecorded(stateDir: string): boolean {
  return existsSync(join(stateDir, COMPLETION_MARKER))
}

/** Drops this run's claim; a recorded completion stays. */
export function releaseOnboarding(stateDir: string): void {
  unlinkIfPresent(join(stateDir, ONBOARDING_MARKER))
}

/** Forgets onboarding entirely: the claim and the completion. */
export function resetOnboarding(stateDir: string): void {
  unlinkIfPresent(join(stateDir, COMPLETION_MARKER))
  unlinkIfPresent(join(stateDir, ONBOARDING_MARKER))
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

function readMarkerTime(stateDir: string, name: string): string | null {
  let raw: string
  try {
    raw = readFileSync(join(stateDir, name), "utf8")
  } catch {
    return null
  }
  const completedAt = parseRecord(raw)?.["completedAt"]
  if (typeof completedAt === "string" && !Number.isNaN(Date.parse(completedAt))) return completedAt
  return mtimeIso(join(stateDir, name))
}

// Before claims and completion were split, the claim marker itself meant completed.
function readLegacyCompletion(stateDir: string): string | null {
  let raw: string
  try {
    raw = readFileSync(join(stateDir, ONBOARDING_MARKER), "utf8")
  } catch {
    return null
  }
  const parsed = parseRecord(raw)
  if (parsed !== undefined && typeof parsed["claimedAt"] === "string") return null
  return readMarkerTime(stateDir, ONBOARDING_MARKER)
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function mtimeIso(path: string): string | null {
  try {
    return new Date(statSync(path).mtimeMs).toISOString()
  } catch {
    return null
  }
}

export function getOnboardingMarkerMtime(stateDir: string): number | null {
  try {
    return statSync(join(stateDir, ONBOARDING_MARKER)).mtimeMs
  } catch {
    return null
  }
}

export function writeGlobalDecline(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true })
  const dest = join(stateDir, GLOBAL_DECLINE_FILE)
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify({ declinedAt: Date.now() }), { mode: 0o600 })
    renameSync(tmp, dest)
  } finally {
    try { unlinkSync(tmp) } catch { /* already renamed or never created */ }
  }
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
  const dest = join(dir, repoHash)
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify({ declinedAt: Date.now() }), { mode: 0o600 })
    renameSync(tmp, dest)
  } finally {
    try { unlinkSync(tmp) } catch { /* already renamed or never created */ }
  }
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
  writeFileSync(
    join(dir, repoHash),
    JSON.stringify({ until: at + COOLDOWN_DAYS * MS_PER_DAY }),
    { flag: "w", mode: 0o600 },
  )
}

export function isCoolingDown(stateDir: string, repoHash: string, now: number): boolean {
  let raw: string
  try {
    raw = readFileSync(join(stateDir, COOLDOWN_DIR, repoHash), "utf8")
  } catch {
    return false
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  if (!isRecord(parsed)) return false
  const until = parsed["until"]
  if (typeof until !== "number" || !Number.isFinite(until) || until < 0) return false
  return now < until
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const code = error["code"]
  return typeof code === "string" ? code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
