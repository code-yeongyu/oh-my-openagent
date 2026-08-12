import { randomUUID } from "node:crypto"
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import {
  createLockRecord,
  getPidLiveness,
  withLock,
} from "@oh-my-opencode/memory-core"

import type { RunLivenessSeams } from "./run-liveness"

export type RunTerminalClaimKind = "publish" | "abandon"

type RecoveryReason = "invalid" | "dead-publish"

type RunTerminalClaimSeams = RunLivenessSeams & {
  readonly beforeRecovery?: (reason: RecoveryReason) => Promise<void>
}

type ClaimSnapshot = {
  readonly raw: string
  readonly claim: RunTerminalClaim | undefined
}

export interface RunTerminalClaim {
  readonly version: 1
  readonly kind: RunTerminalClaimKind
  readonly runId: string
  readonly attempt: number
  readonly claimantPid: number
}

export function runTerminalClaimPath(runDir: string): string {
  return join(runDir, "terminal-claim.json")
}

export async function claimRunTerminal(
  runDir: string,
  identity: { readonly runId: string; readonly attempt: number },
  kind: RunTerminalClaimKind,
  seams: RunTerminalClaimSeams = {},
  claimantPid = process.pid,
): Promise<RunTerminalClaim> {
  const path = runTerminalClaimPath(runDir)
  const requested: RunTerminalClaim = {
    version: 1,
    kind,
    runId: identity.runId,
    attempt: identity.attempt,
    claimantPid,
  }
  let discarded = 0
  for (;;) {
    if (createExclusiveClaim(path, requested)) return requested
    const snapshot = readClaimSnapshot(path)
    if (snapshot === undefined) continue
    const existing = snapshot.claim
    if (existing === undefined) {
      // A claim only becomes visible complete, so an unreadable one authorized
      // nothing and is discarded rather than stranding the run forever.
      if (discarded > 0) throw new TypeError("Invalid run terminal claim")
      discarded += 1
      await seams.beforeRecovery?.("invalid")
      const replacement = await recoverClaim(runDir, path, snapshot, "invalid", identity, seams)
      if (replacement !== undefined) return replacement
      continue
    }
    if (runTerminalClaimMatches(existing, identity, kind)) return existing
    if (existing.kind !== "publish" || !claimantIsConfirmedDead(existing, seams)) return existing
    await seams.beforeRecovery?.("dead-publish")
    const replacement = await recoverClaim(runDir, path, snapshot, "dead-publish", identity, seams)
    if (replacement !== undefined) return replacement
  }
}

export function readRunTerminalClaim(runDir: string): RunTerminalClaim {
  return parseRunTerminalClaim(JSON.parse(readFileSync(runTerminalClaimPath(runDir), "utf8")))
}

export function runTerminalClaimMatches(
  claim: RunTerminalClaim,
  identity: { readonly runId: string; readonly attempt: number },
  kind?: RunTerminalClaimKind,
): boolean {
  return claim.runId === identity.runId
    && claim.attempt === identity.attempt
    && (kind === undefined || claim.kind === kind)
}

function createExclusiveClaim(path: string, claim: RunTerminalClaim): boolean {
  const candidate = `${path}.${process.pid}.${randomUUID()}.candidate`
  writeDurableClaim(candidate, claim)
  try {
    linkSync(candidate, path)
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  } finally {
    removeClaim(candidate)
  }
  syncDirectory(dirname(path))
  return true
}

function writeDurableClaim(path: string, claim: RunTerminalClaim): void {
  const file = openSync(path, "wx", 0o600)
  try {
    writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, "utf8")
    fsyncSync(file)
  } finally {
    closeSync(file)
  }
}

function readClaimSnapshot(path: string): ClaimSnapshot | undefined {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
  try {
    return { raw, claim: parseRunTerminalClaim(JSON.parse(raw)) }
  } catch {
    return { raw, claim: undefined }
  }
}

async function recoverClaim(
  runDir: string,
  claimPath: string,
  inspected: ClaimSnapshot,
  reason: RecoveryReason,
  identity: { readonly runId: string; readonly attempt: number },
  seams: RunTerminalClaimSeams,
): Promise<RunTerminalClaim | undefined> {
  const record = await createLockRecord("reflection-finalize", { runId: identity.runId })
  return withLock(join(runDir, "terminal-claim-recovery.lock"), record, async () => {
    const current = readClaimSnapshot(claimPath)
    if (current === undefined) return undefined
    if (current.raw !== inspected.raw) return current.claim
    if (reason === "invalid") {
      if (current.claim !== undefined) return current.claim
    } else {
      if (current.claim === undefined) return undefined
      if (current.claim.kind !== "publish" || !claimantIsConfirmedDead(current.claim, seams)) return current.claim
    }
    removeClaim(claimPath)
    return undefined
  }, { waitTimeoutMs: Number.POSITIVE_INFINITY })
}

function removeClaim(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

function claimantIsConfirmedDead(claim: RunTerminalClaim, seams: RunLivenessSeams): boolean {
  return (seams.getPidLiveness ?? getPidLiveness)(claim.claimantPid) === "dead"
}

function parseRunTerminalClaim(value: unknown): RunTerminalClaim {
  if (!isRecord(value)
    || value.version !== 1
    || (value.kind !== "publish" && value.kind !== "abandon")
    || typeof value.runId !== "string"
    || !Number.isInteger(value.attempt)
    || !Number.isInteger(value.claimantPid)
    || Number(value.claimantPid) <= 0) {
    throw new TypeError("Invalid run terminal claim")
  }
  return {
    version: 1,
    kind: value.kind,
    runId: value.runId,
    attempt: Number(value.attempt),
    claimantPid: Number(value.claimantPid),
  }
}

function syncDirectory(path: string): void {
  let directory: number
  try {
    directory = openSync(path, "r")
  } catch (error) {
    if (process.platform === "win32" && ["EISDIR", "EPERM"].includes(errorCode(error) ?? "")) return
    throw error
  }
  try {
    fsyncSync(directory)
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "EINVAL"].includes(errorCode(error) ?? "")) throw error
  } finally {
    closeSync(directory)
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
