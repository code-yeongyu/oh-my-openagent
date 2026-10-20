// The device's pinned account root (sync-design section 7; #10298 review round 3). One directory per
// account under `<stateDir>/trust-anchor/`, named from the account's hash and holding `pin.json`. It is
// written once, only from a pin candidate a fully verified bootstrap walk minted, through the
// device-peer pattern: a private candidate directory published by an atomic rename that fails when
// the target exists, so a pin is never partial and never overwritten. The pin file and the candidate
// directory are fsynced before the rename and the parent after it, so a published pin survives a crash.
// A crash before the rename leaves only a candidate directory, removed by the next load. A writer that
// loses the rename to another gets that writer's pin, or a typed conflict when it holds another root.
// A missing, corrupt or mismatching pin, or an account directory without its pin file, is NO anchor: the caller refuses and tells the user to re-pair or recover, never trusting the
// server or a fresh bootstrap walk on its own.

import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "../../fs/resilient"
import { syncJournalDirectory, syncJournalFile } from "../../journal/fsync"
import { ANCHOR_NEXT_STEP, isPinCandidate, mintTrustAnchor, type PinCandidate, type TrustAnchor } from "./anchor.ts"
import { decodeB64 } from "./signatures.ts"

export type PinLoad =
  | { readonly ok: true; readonly anchor: TrustAnchor }
  | { readonly ok: false; readonly reason: "no_pin" | "corrupt_pin"; readonly next: typeof ANCHOR_NEXT_STEP }

export type TrustPinProblem = "not_verified" | "pin_conflict" | "corrupt_pin"

export class TrustPinError extends Error {
  override readonly name = "TrustPinError"
  readonly next = ANCHOR_NEXT_STEP
  constructor(readonly problem: TrustPinProblem) {
    super(`trust pin refused: ${problem}; ${ANCHOR_NEXT_STEP}`)
  }
}

const PIN_FILE = "pin.json"
const SOURCES = new Set(["pairing", "recovery", "creator"])

const accountKey = (account: string): string => createHash("sha256").update(account, "utf8").digest("base64url")
const rootDir = (stateDir: string): string => join(stateDir, "trust-anchor")
const pinDir = (stateDir: string, account: string): string => join(rootDir(stateDir), accountKey(account))

const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT"

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

const cleanStaleCandidates = async (stateDir: string, account: string): Promise<void> => {
  const prefix = `${accountKey(account)}.`
  let names: string[]
  try {
    names = await readdir(rootDir(stateDir))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
  for (const name of names) {
    const pid = Number(name.slice(prefix.length).split(".")[0])
    if (name.startsWith(prefix) && name.endsWith(".tmp") && Number.isSafeInteger(pid) && !alive(pid)) {
      await rm(join(rootDir(stateDir), name), { recursive: true, force: true })
    }
  }
}

const hasExactly = (value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",")

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const parsePin = (raw: string, account: string): TrustAnchor | null => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || !hasExactly(value, ["version", "account", "genesis_digest", "pinned_by", "pinned_at"])) return null
  const at = value["pinned_at"]
  const digest = value["genesis_digest"]
  if (value["version"] !== 1 || value["account"] !== account || typeof digest !== "string" || decodeB64(digest, 32) === null) return null
  if (typeof value["pinned_by"] !== "string" || !SOURCES.has(value["pinned_by"])) return null
  if (!isRecord(at) || !hasExactly(at, ["seq", "keyring_link"]) || !Number.isSafeInteger(at["seq"]) || Number(at["seq"]) < 1) return null
  if (typeof at["keyring_link"] !== "string" || decodeB64(at["keyring_link"], 32) === null) return null
  return mintTrustAnchor(account, digest)
}

/** The pinned root for `account`, or no anchor at all (with the reason and the user's next step). */
export const loadTrustAnchor = async (stateDir: string, account: string): Promise<PinLoad> => {
  await cleanStaleCandidates(stateDir, account)
  let raw: string
  try {
    raw = await readFile(join(pinDir(stateDir, account), PIN_FILE), "utf8")
  } catch (error) {
    if (!isMissing(error)) throw error
    try {
      await stat(pinDir(stateDir, account))
    } catch (dirError) {
      if (isMissing(dirError)) return { ok: false, reason: "no_pin", next: ANCHOR_NEXT_STEP }
      throw dirError
    }
    return { ok: false, reason: "corrupt_pin", next: ANCHOR_NEXT_STEP }
  }
  const anchor = parsePin(raw, account)
  return anchor === null ? { ok: false, reason: "corrupt_pin", next: ANCHOR_NEXT_STEP } : { ok: true, anchor }
}

/**
 * Persists the root a verified bootstrap walk proved, once. The same root again returns the existing
 * pin; a different root, or a pin file that does not parse, throws and changes nothing. Losing the
 * publishing rename to a concurrent writer is decided the same way, by the pin that writer published.
 */
export const pinTrustAnchor = async (stateDir: string, account: string, candidate: PinCandidate): Promise<TrustAnchor> => {
  if (!isPinCandidate(candidate) || candidate.account !== account) throw new TrustPinError("not_verified")
  const existing = await loadTrustAnchor(stateDir, account)
  if (existing.ok) {
    if (existing.anchor.genesisDigest === candidate.genesisDigest) return existing.anchor
    throw new TrustPinError("pin_conflict")
  }
  if (existing.reason === "corrupt_pin") throw new TrustPinError("corrupt_pin")
  const target = pinDir(stateDir, account)
  await mkdir(rootDir(stateDir), { recursive: true, mode: 0o700 })
  const staging = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await mkdir(staging, { mode: 0o700 })
  const pin = { version: 1, account, genesis_digest: candidate.genesisDigest, pinned_by: candidate.pinnedBy, pinned_at: { ...candidate.at } }
  try {
    await writeFile(join(staging, PIN_FILE), `${JSON.stringify(pin)}\n`, { flag: "wx", mode: 0o600 })
    await syncJournalFile(join(staging, PIN_FILE))
    await syncJournalDirectory(staging)
    try {
      await rename(staging, target)
    } catch (error) {
      if (!(await loadTrustAnchor(stateDir, account)).ok) throw error
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  await syncJournalDirectory(rootDir(stateDir))
  const written = await loadTrustAnchor(stateDir, account)
  if (!written.ok || written.anchor.genesisDigest !== candidate.genesisDigest) throw new TrustPinError("pin_conflict")
  return written.anchor
}

/**
 * Retires the pin so a new pairing or recovery can set one. Only the user-driven re-pair and
 * recovery flows call this; it is not exported from the package, and no sync path reaches it.
 */
export const forgetTrustAnchor = async (stateDir: string, account: string): Promise<void> => {
  try {
    await rename(pinDir(stateDir, account), `${pinDir(stateDir, account)}.retired-${Date.now()}-${randomBytes(4).toString("hex")}`)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}
