// Who holds the reflection lock, decided fail-closed (#10377). This is the one decision behind the
// session's stale-lock recovery and the `omo doctor` report: the CLI runs a generated bundle of this
// file (script/build-reflection-lock.ts, checked for staleness by its test), so the two cannot drift.
//
// Dead means all of: the launcher on this host is gone (or its pid now belongs to another process),
// the publish claimant, if any, is gone, and the run recorded a valid outcome. Anything that cannot be
// proven is "stuck", never "dead". Each rule carries a `rule:` tag named by its test.

import { execFile } from "node:child_process"
import { hostname as readHostname } from "node:os"
import { join } from "node:path"

import { readFile } from "../fs/resilient"
import { getPidLiveness, getProcessStartIdentity, startIdentitiesComparable, type ProcessLiveness } from "../locks/process-identity"

export type ReflectionLockVerdict =
  | { readonly state: "none" }
  | { readonly state: "live"; readonly runId: string }
  | { readonly state: "dead"; readonly runId: string }
  | { readonly state: "stuck"; readonly runId: string; readonly reason: string }

export interface ReflectionLockProbe {
  readonly readText?: (path: string) => Promise<string>
  readonly hostname?: () => string
  readonly hostId?: () => string | null | Promise<string | null>
  readonly isLocalHost?: (
    recorded: { readonly hostname: string; readonly hostId?: string },
    current: { readonly hostname: string; readonly hostId?: string | null },
  ) => boolean
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
}

type JsonRead =
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly code: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly value: unknown }

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown error"
}

async function readJson(path: string, readText: (path: string) => Promise<string>): Promise<JsonRead> {
  let text: string
  try {
    text = await readText(path)
  } catch (error) {
    const code = errorCode(error)
    return code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable", code }
  }
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown }
  } catch {
    return { kind: "invalid" }
  }
}

function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

// The shape reconciliation reads as a RunOutcome (omo-senpi worker/run-artifacts.ts). A file that does
// not match it, or names another run, is not a recorded outcome, so nothing is finalized on it.
function isRunOutcome(value: unknown, runId: string): boolean {
  const fields = fieldsOf(value)
  const childExit = fieldsOf(fields.childExit)
  return fields.version === 1
    && fields.runId === runId
    && typeof fields.finishedAt === "string"
    && (fields.attempt === undefined || (typeof fields.attempt === "number" && Number.isInteger(fields.attempt) && fields.attempt > 0))
    && typeof fields.childExit === "object" && fields.childExit !== null
    && (childExit.code === null || typeof childExit.code === "number")
    && (childExit.signal === null || typeof childExit.signal === "string")
    && typeof fields.timedOut === "boolean"
}

export interface HostIdentity {
  readonly hostname: string
  readonly hostId?: string | null
}

/** Trimmed stdout of a short-lived probe, or `null` when it fails or times out. */
async function readCommandOutput(command: string, args: readonly string[], timeoutMs: number): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      const value = stdout.trim()
      resolve(value.length > 0 ? value : null)
    })
  })
}

/** Extracts the firmware UUID from `ioreg -c IOPlatformExpertDevice` output. */
export function parsePlatformUuid(ioreg: string | null): string | null {
  if (ioreg === null) return null
  const uuid = /"IOPlatformUUID"\s*=\s*"([^"]*)"/.exec(ioreg)?.[1]?.trim()
  return uuid === undefined || uuid.length === 0 ? null : uuid
}

type CommandRunner = (command: string, args: readonly string[], timeoutMs: number) => Promise<string | null>

/**
 * Absolute path, because a child spawned without `PATH` fails a bare `ioreg` with ENOENT and would
 * silently drop every machine to "no identity".
 */
export function createPlatformUuidReader(run: CommandRunner = readCommandOutput): () => Promise<string | null> {
  return async () => parsePlatformUuid(await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], 1_000))
}

const readDarwinPlatformUuid = createPlatformUuidReader()

/** Single flight, and only an answer is remembered: caching `null` would pin a busy process to "unknown machine". */
export function createMachineIdResolver(read: () => Promise<string | null>): () => Promise<string | null> {
  let cached: Promise<string | null> | undefined
  return () => {
    if (cached !== undefined) return cached
    let pending: Promise<string | null>
    pending = read().then((value) => {
      if (value === null && cached === pending) cached = undefined
      return value
    })
    cached = pending
    return pending
  }
}

/** This machine's identity, or `null` where no probe exists. The prefix makes `active.lock` self-describing. */
export const getStableLocalHostId = createMachineIdResolver(async () => {
  if (process.platform !== "darwin") return null
  const uuid = await readDarwinPlatformUuid()
  return uuid === null ? null : `darwin-uuid:${uuid}`
})

/**
 * Two known ids must match, so machines sharing a hostname stay distinct while one renamed by DHCP
 * still matches. A missing id on either side falls back to the hostname, because an unknown id never
 * proves another host.
 */
export function isLocalHost(recorded: HostIdentity, current: HostIdentity): boolean {
  const recordedId = recorded.hostId
  const currentId = current.hostId
  if (typeof recordedId === "string" && recordedId.length > 0 && typeof currentId === "string" && currentId.length > 0) {
    return recordedId === currentId
  }
  return recorded.hostname === current.hostname
}

function stuck(runId: string, reason: string): ReflectionLockVerdict {
  return { state: "stuck", runId, reason }
}

// A live pid still counts as gone when its recorded start identity proves the pid was reused: the rule
// reconciliation applies (worker/run-liveness.ts). An unreadable or incomparable start keeps it live.
async function launcherLiveness(pid: number, recordedStart: unknown, probe: ReflectionLockProbe): Promise<ProcessLiveness> {
  const liveness = (probe.getPidLiveness ?? getPidLiveness)(pid)
  if (liveness !== "alive" || typeof recordedStart !== "string") return liveness
  const actualStart = await (probe.getProcessStartIdentity ?? getProcessStartIdentity)(pid).catch(() => null)
  if (actualStart !== null && startIdentitiesComparable(recordedStart, actualStart) && recordedStart !== actualStart) return "dead" // rule:pid-reused
  return "alive"
}

export async function classifyReflectionLockHolder(
  reflectionDir: string,
  probe: ReflectionLockProbe = {},
): Promise<ReflectionLockVerdict> {
  const readText = probe.readText ?? ((path: string) => readFile(path, "utf8"))
  const active = await readJson(join(reflectionDir, "active.lock"), readText)
  if (active.kind === "missing") return { state: "none" }
  if (active.kind === "unreadable") return stuck("unknown", `active.lock could not be read (${active.code})`) // rule:lock-unreadable
  if (active.kind === "invalid") return stuck("unknown", "active.lock is not valid JSON") // rule:lock-invalid
  const fields = fieldsOf(active.value)
  const runId = typeof fields.runId === "string" ? fields.runId : "unknown"
  const launcherPid = typeof fields.launcherPid === "number" ? fields.launcherPid : undefined
  const launcherHostname = typeof fields.launcherHostname === "string" ? fields.launcherHostname : undefined
  const launcherHostId = typeof fields.launcherHostId === "string" ? fields.launcherHostId : undefined
  if (launcherPid === undefined || launcherHostname === undefined) return stuck(runId, "its launcher identity is missing") // rule:launcher-identity

  const currentHost = {
    hostname: (probe.hostname ?? readHostname)(),
    hostId: await (probe.hostId ?? getStableLocalHostId)(),
  }
  const localCheck = probe.isLocalHost ?? isLocalHost
  if (!localCheck({ hostname: launcherHostname, hostId: launcherHostId }, currentHost)) {
    return stuck(runId, `it is owned by host ${launcherHostname}, which cannot be checked from here`) // rule:other-host
  }
  const launcher = await launcherLiveness(launcherPid, fields.launcherProcessStart, probe)
  if (launcher === "alive") return { state: "live", runId } // rule:launcher-alive
  if (launcher === "unknown") return stuck(runId, `launcher pid ${launcherPid} could not be checked`) // rule:launcher-unknown
  const runDir = join(reflectionDir, "runs", runId)
  const outcome = await readJson(join(runDir, "outcome.json"), readText)
  if (outcome.kind === "missing") return stuck(runId, `launcher pid ${launcherPid} is gone and the run recorded no outcome`) // rule:outcome-missing
  if (outcome.kind === "unreadable") return stuck(runId, `its outcome could not be read (${outcome.code})`) // rule:outcome-unreadable
  if (outcome.kind === "invalid") return stuck(runId, "its outcome is not valid JSON") // rule:outcome-invalid
  if (!isRunOutcome(outcome.value, runId)) return stuck(runId, "its outcome is not a recorded run outcome") // rule:outcome-schema
  const claim = await readJson(join(runDir, "terminal-claim.json"), readText)
  if (claim.kind === "unreadable") return stuck(runId, `its terminal claim could not be read (${claim.code})`) // rule:claim-unreadable
  if (claim.kind === "invalid") return stuck(runId, "its terminal claim is not valid JSON") // rule:claim-invalid
  if (claim.kind === "ok") {
    const claimantPid = fieldsOf(claim.value).claimantPid
    if (typeof claimantPid !== "number") return stuck(runId, "its terminal claim names no claimant") // rule:claim-no-claimant
    const claimant = (probe.getPidLiveness ?? getPidLiveness)(claimantPid)
    if (claimant === "alive") return { state: "live", runId } // rule:claimant-alive
    if (claimant === "unknown") return stuck(runId, `publish claimant pid ${claimantPid} could not be checked`) // rule:claimant-unknown
  }
  return { state: "dead", runId }
}
