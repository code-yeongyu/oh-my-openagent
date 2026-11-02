import { join } from "node:path"

import type { ProcessLiveness } from "../locks/process-identity"
import type { ReflectionLockProbe, ReflectionLockVerdict } from "./stale-holder"

export const REFLECTION_DIR = "/memory/agents/agent-a/runtime/reflection"
const RUN = "reflection-run-64"
const HOST = "this-host"
const LAUNCHER = 11096
const CLAIMANT = 4200
const LOCK = join(REFLECTION_DIR, "active.lock")
const VALID_OUTCOME = JSON.stringify({ version: 1, runId: "reflection-run-64", attempt: 1, finishedAt: "2026-10-17T00:00:00.000Z", childExit: { code: 0, signal: null }, timedOut: false })
const OUTCOME = join(REFLECTION_DIR, "runs", RUN, "outcome.json")
const CLAIM = join(REFLECTION_DIR, "runs", RUN, "terminal-claim.json")

type FileState = string | { readonly error: string }

interface Facts {
  readonly files: Readonly<Record<string, FileState>>
  readonly pids: Readonly<Record<number, ProcessLiveness>>
  readonly starts: Readonly<Record<number, string | null>>
  readonly machineId: string | null
  readonly failMachineId: boolean
}

export interface Scenario {
  readonly name: string
  readonly rule?: string
  readonly facts: Facts
  readonly expected: ReflectionLockVerdict
}

function lock(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ runId: RUN, launcherPid: LAUNCHER, launcherHostname: HOST, ...fields })
}

// A provably dead holder: every rule passes. Each scenario below changes exactly one fact of it.
function deadHolder(change: {
  files?: Record<string, FileState | undefined>
  pids?: Facts["pids"]
  starts?: Facts["starts"]
  machineId?: string | null
  failMachineId?: boolean
} = {}): Facts {
  const files: Record<string, FileState> = { [LOCK]: lock(), [OUTCOME]: VALID_OUTCOME, [CLAIM]: JSON.stringify({ claimantPid: CLAIMANT }) }
  for (const [path, state] of Object.entries(change.files ?? {})) {
    if (state === undefined) delete files[path]
    else files[path] = state
  }
  return {
    files,
    pids: change.pids ?? {},
    starts: change.starts ?? {},
    machineId: change.machineId ?? null,
    failMachineId: change.failMachineId ?? false,
  }
}

const stuck = (runId: string, reason: string): ReflectionLockVerdict => ({ state: "stuck", runId, reason })
const RECORDED_START = "linux-proc-start-ticks:100"

export const SCENARIOS: readonly Scenario[] = [
  { name: "every fact proves the holder gone", facts: deadHolder(), expected: { state: "dead", runId: RUN } },
  { name: "no active.lock", facts: deadHolder({ files: { [LOCK]: undefined } }), expected: { state: "none" } },
  { name: "active.lock cannot be read", rule: "lock-unreadable", facts: deadHolder({ files: { [LOCK]: { error: "EACCES" } } }), expected: stuck("unknown", "active.lock could not be read (EACCES)") },
  { name: "active.lock is not JSON", rule: "lock-invalid", facts: deadHolder({ files: { [LOCK]: "{not json" } }), expected: stuck("unknown", "active.lock is not valid JSON") },
  { name: "active.lock is the JSON literal null", facts: deadHolder({ files: { [LOCK]: "null" } }), expected: stuck("unknown", "its launcher identity is missing") },
  { name: "the launcher pid is missing", rule: "launcher-identity", facts: deadHolder({ files: { [LOCK]: JSON.stringify({ runId: RUN, launcherHostname: HOST }) } }), expected: stuck(RUN, "its launcher identity is missing") },
  { name: "another host owns the lock", rule: "other-host", facts: deadHolder({ files: { [LOCK]: lock({ launcherHostname: "other-host" }) } }), expected: stuck(RUN, "it is owned by host other-host, which cannot be checked from here") },
  { name: "another machine holds the lock under the same hostname", rule: "machine-id", facts: deadHolder({ machineId: "machine-b", files: { [LOCK]: lock({ launcherMachineHash: "machine-a" }) } }), expected: stuck(RUN, "it is owned by a different machine (host this-host), which cannot be checked from here") },
  { name: "the same machine with a renamed hostname still owns its dead lock", rule: "machine-id-renamed-host", facts: deadHolder({ machineId: "machine-a", files: { [LOCK]: lock({ launcherMachineHash: "machine-a", launcherHostname: "other-host" }) } }), expected: { state: "dead", runId: RUN } },
  { name: "a null machine id lookup falls back to hostname equality", rule: "machine-id-null", facts: deadHolder({ machineId: null, files: { [LOCK]: lock({ launcherMachineHash: "machine-a" }) } }), expected: { state: "dead", runId: RUN } },
  { name: "no machine id is read when active.lock is absent", rule: "machine-id-hot-path", facts: deadHolder({ failMachineId: true, files: { [LOCK]: undefined } }), expected: { state: "none" } },
  { name: "no machine id is read when the record carries no launcherMachineHash", rule: "machine-id-hot-path", facts: deadHolder({ failMachineId: true }), expected: { state: "dead", runId: RUN } },
  { name: "the launcher is alive", rule: "launcher-alive", facts: deadHolder({ pids: { [LAUNCHER]: "alive" } }), expected: { state: "live", runId: RUN } },
  { name: "the launcher cannot be checked", rule: "launcher-unknown", facts: deadHolder({ pids: { [LAUNCHER]: "unknown" } }), expected: stuck(RUN, `launcher pid ${LAUNCHER} could not be checked`) },
  { name: "the launcher pid was reused by another process", rule: "pid-reused", facts: deadHolder({ files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) }, pids: { [LAUNCHER]: "alive" }, starts: { [LAUNCHER]: "linux-proc-start-ticks:999" } }), expected: { state: "dead", runId: RUN } },
  { name: "the launcher pid still has its recorded start", facts: deadHolder({ files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) }, pids: { [LAUNCHER]: "alive" }, starts: { [LAUNCHER]: RECORDED_START } }), expected: { state: "live", runId: RUN } },
  { name: "the launcher start cannot be read", facts: deadHolder({ files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) }, pids: { [LAUNCHER]: "alive" }, starts: { [LAUNCHER]: null } }), expected: { state: "live", runId: RUN } },
  { name: "the launcher start uses another scheme", facts: deadHolder({ files: { [LOCK]: lock({ launcherProcessStart: "ps-lstart:Fri Oct 17 10:00:00 2026" }) }, pids: { [LAUNCHER]: "alive" }, starts: { [LAUNCHER]: "proc-start-epoch:1792200000" } }), expected: { state: "live", runId: RUN } },
  { name: "the run recorded no outcome", rule: "outcome-missing", facts: deadHolder({ files: { [OUTCOME]: undefined } }), expected: stuck(RUN, `launcher pid ${LAUNCHER} is gone and the run recorded no outcome`) },
  { name: "the outcome cannot be read", rule: "outcome-unreadable", facts: deadHolder({ files: { [OUTCOME]: { error: "EIO" } } }), expected: stuck(RUN, "its outcome could not be read (EIO)") },
  { name: "the outcome is not JSON", rule: "outcome-invalid", facts: deadHolder({ files: { [OUTCOME]: "{\"version\": 1, \"runId\": " } }), expected: stuck(RUN, "its outcome is not valid JSON") },
  { name: "the outcome is JSON but not a run outcome", rule: "outcome-schema", facts: deadHolder({ files: { [OUTCOME]: JSON.stringify({ version: 1, runId: RUN }) } }), expected: stuck(RUN, "its outcome is not a recorded run outcome") },
  { name: "the outcome names another run", facts: deadHolder({ files: { [OUTCOME]: VALID_OUTCOME.replace(RUN, "reflection-run-63") } }), expected: stuck(RUN, "its outcome is not a recorded run outcome") },
  { name: "the outcome is the JSON literal null", facts: deadHolder({ files: { [OUTCOME]: "null" } }), expected: stuck(RUN, "its outcome is not a recorded run outcome") },
  { name: "the run failed but recorded a valid outcome", facts: deadHolder({ files: { [OUTCOME]: JSON.stringify({ version: 1, runId: RUN, finishedAt: "2026-10-17T00:00:00.000Z", childExit: { code: null, signal: "SIGKILL" }, timedOut: true }) } }), expected: { state: "dead", runId: RUN } },
  { name: "the terminal claim cannot be read", rule: "claim-unreadable", facts: deadHolder({ files: { [CLAIM]: { error: "EACCES" } } }), expected: stuck(RUN, "its terminal claim could not be read (EACCES)") },
  { name: "the terminal claim is not JSON", rule: "claim-invalid", facts: deadHolder({ files: { [CLAIM]: "{" } }), expected: stuck(RUN, "its terminal claim is not valid JSON") },
  { name: "the terminal claim names no claimant", rule: "claim-no-claimant", facts: deadHolder({ files: { [CLAIM]: "{}" } }), expected: stuck(RUN, "its terminal claim names no claimant") },
  { name: "the publish claimant is alive", rule: "claimant-alive", facts: deadHolder({ pids: { [CLAIMANT]: "alive" } }), expected: { state: "live", runId: RUN } },
  { name: "the publish claimant cannot be checked", rule: "claimant-unknown", facts: deadHolder({ pids: { [CLAIMANT]: "unknown" } }), expected: stuck(RUN, `publish claimant pid ${CLAIMANT} could not be checked`) },
  { name: "no publish claim was made", facts: deadHolder({ files: { [CLAIM]: undefined } }), expected: { state: "dead", runId: RUN } },
]

export function probeFor(facts: Facts): ReflectionLockProbe {
  return {
    readText: async (path) => {
      const state = facts.files[path]
      if (state === undefined) throw Object.assign(new Error(`no such file: ${path}`), { code: "ENOENT" })
      if (typeof state !== "string") throw Object.assign(new Error(state.error), { code: state.error })
      return state
    },
    hostname: () => HOST,
    machineHash: async () => {
      if (facts.failMachineId) throw new Error("machine id must not be read")
      return facts.machineId
    },
    getPidLiveness: (pid) => facts.pids[pid] ?? "dead",
    getProcessStartIdentity: async (pid) => facts.starts[pid] ?? null,
  }
}
