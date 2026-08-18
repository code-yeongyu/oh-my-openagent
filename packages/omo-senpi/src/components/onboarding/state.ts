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

const ONBOARDING_MARKER = "onboarding-completed"
const GLOBAL_DECLINE_FILE = "onboarding-declined-global"
const PROJECT_DECLINE_DIR = "onboarding-declined-projects"
const COOLDOWN_DIR = "onboarding-cooldowns"

export function claimOnboarding(stateDir: string): boolean {
  try {
    mkdirSync(stateDir, { recursive: true })
  } catch {
    return false
  }
  try {
    writeFileSync(
      join(stateDir, ONBOARDING_MARKER),
      JSON.stringify({ completedAt: new Date().toISOString(), version: 1 }),
      { flag: "wx", mode: 0o600 },
    )
    return true
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    return false
  }
}

export function isOnboardingComplete(stateDir: string): boolean {
  try {
    return existsSync(join(stateDir, ONBOARDING_MARKER))
  } catch {
    return false
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
