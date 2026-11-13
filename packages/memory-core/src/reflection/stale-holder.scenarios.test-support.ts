import { basename, join, sep } from "node:path"

import type { ProcessLiveness } from "../locks/process-identity"
import type { ReflectionLockProbe, ReflectionLockVerdict } from "./stale-holder"
import type { StaleLockDecision, StaleLockProbe, StrandedRunDecision } from "./stale-lock-reaper"

export const REFLECTION_DIR = "/memory/agents/agent-a/runtime/reflection"
const RUN = "reflection-run-64"
const HOST = "this-host"
const LAUNCHER = 11096
const CLAIMANT = 4200
const LOCK = join(REFLECTION_DIR, "active.lock")
const VALID_OUTCOME = JSON.stringify({
  version: 1,
  runId: "reflection-run-64",
  attempt: 1,
  finishedAt: "2026-10-17T00:00:00.000Z",
  childExit: { code: 0, signal: null },
  timedOut: false,
})
const OUTCOME = join(REFLECTION_DIR, "runs", RUN, "outcome.json")
const CLAIM = join(REFLECTION_DIR, "runs", RUN, "terminal-claim.json")

type FileState = string | { readonly error: string }

interface Facts {
  readonly files: Readonly<Record<string, FileState>>
  readonly pids: Readonly<Record<number, ProcessLiveness>>
  readonly starts: Readonly<Record<number, string | null>>
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
function deadHolder(
  change: { files?: Record<string, FileState | undefined>; pids?: Facts["pids"]; starts?: Facts["starts"] } = {},
): Facts {
  const files: Record<string, FileState> = {
    [LOCK]: lock(),
    [OUTCOME]: VALID_OUTCOME,
    [CLAIM]: JSON.stringify({ claimantPid: CLAIMANT }),
  }
  for (const [path, state] of Object.entries(change.files ?? {})) {
    if (state === undefined) delete files[path]
    else files[path] = state
  }
  return { files, pids: change.pids ?? {}, starts: change.starts ?? {} }
}

const stuck = (runId: string, reason: string): ReflectionLockVerdict => ({ state: "stuck", runId, reason })
const RECORDED_START = "linux-proc-start-ticks:100"

export const SCENARIOS: readonly Scenario[] = [
  { name: "every fact proves the holder gone", facts: deadHolder(), expected: { state: "dead", runId: RUN } },
  { name: "no active.lock", facts: deadHolder({ files: { [LOCK]: undefined } }), expected: { state: "none" } },
  {
    name: "active.lock cannot be read",
    rule: "lock-unreadable",
    facts: deadHolder({ files: { [LOCK]: { error: "EACCES" } } }),
    expected: stuck("unknown", "active.lock could not be read (EACCES)"),
  },
  {
    name: "active.lock is not JSON",
    rule: "lock-invalid",
    facts: deadHolder({ files: { [LOCK]: "{not json" } }),
    expected: stuck("unknown", "active.lock is not valid JSON"),
  },
  {
    name: "active.lock is the JSON literal null",
    facts: deadHolder({ files: { [LOCK]: "null" } }),
    expected: stuck("unknown", "its launcher identity is missing"),
  },
  {
    name: "the launcher pid is missing",
    rule: "launcher-identity",
    facts: deadHolder({ files: { [LOCK]: JSON.stringify({ runId: RUN, launcherHostname: HOST }) } }),
    expected: stuck(RUN, "its launcher identity is missing"),
  },
  {
    name: "another host owns the lock",
    rule: "other-host",
    facts: deadHolder({ files: { [LOCK]: lock({ launcherHostname: "other-host" }) } }),
    expected: stuck(RUN, "it is owned by host other-host, which cannot be checked from here"),
  },
  {
    name: "the launcher is alive",
    rule: "launcher-alive",
    facts: deadHolder({ pids: { [LAUNCHER]: "alive" } }),
    expected: { state: "live", runId: RUN },
  },
  {
    name: "the launcher cannot be checked",
    rule: "launcher-unknown",
    facts: deadHolder({ pids: { [LAUNCHER]: "unknown" } }),
    expected: stuck(RUN, `launcher pid ${LAUNCHER} could not be checked`),
  },
  {
    name: "the launcher pid was reused by another process",
    rule: "pid-reused",
    facts: deadHolder({
      files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) },
      pids: { [LAUNCHER]: "alive" },
      starts: { [LAUNCHER]: "linux-proc-start-ticks:999" },
    }),
    expected: { state: "dead", runId: RUN },
  },
  {
    name: "the launcher pid still has its recorded start",
    facts: deadHolder({
      files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) },
      pids: { [LAUNCHER]: "alive" },
      starts: { [LAUNCHER]: RECORDED_START },
    }),
    expected: { state: "live", runId: RUN },
  },
  {
    name: "the launcher start cannot be read",
    facts: deadHolder({
      files: { [LOCK]: lock({ launcherProcessStart: RECORDED_START }) },
      pids: { [LAUNCHER]: "alive" },
      starts: { [LAUNCHER]: null },
    }),
    expected: { state: "live", runId: RUN },
  },
  {
    name: "the launcher start uses another scheme",
    facts: deadHolder({
      files: { [LOCK]: lock({ launcherProcessStart: "ps-lstart:Fri Oct 17 10:00:00 2026" }) },
      pids: { [LAUNCHER]: "alive" },
      starts: { [LAUNCHER]: "proc-start-epoch:1792200000" },
    }),
    expected: { state: "live", runId: RUN },
  },
  {
    name: "the run recorded no outcome",
    rule: "outcome-missing",
    facts: deadHolder({ files: { [OUTCOME]: undefined } }),
    expected: stuck(RUN, `launcher pid ${LAUNCHER} is gone and the run recorded no outcome`),
  },
  {
    name: "the outcome cannot be read",
    rule: "outcome-unreadable",
    facts: deadHolder({ files: { [OUTCOME]: { error: "EIO" } } }),
    expected: stuck(RUN, "its outcome could not be read (EIO)"),
  },
  {
    name: "the outcome is not JSON",
    rule: "outcome-invalid",
    facts: deadHolder({ files: { [OUTCOME]: '{"version": 1, "runId": ' } }),
    expected: stuck(RUN, "its outcome is not valid JSON"),
  },
  {
    name: "the outcome is JSON but not a run outcome",
    rule: "outcome-schema",
    facts: deadHolder({ files: { [OUTCOME]: JSON.stringify({ version: 1, runId: RUN }) } }),
    expected: stuck(RUN, "its outcome is not a recorded run outcome"),
  },
  {
    name: "the outcome names another run",
    facts: deadHolder({ files: { [OUTCOME]: VALID_OUTCOME.replace(RUN, "reflection-run-63") } }),
    expected: stuck(RUN, "its outcome is not a recorded run outcome"),
  },
  {
    name: "the outcome is the JSON literal null",
    facts: deadHolder({ files: { [OUTCOME]: "null" } }),
    expected: stuck(RUN, "its outcome is not a recorded run outcome"),
  },
  {
    name: "the run failed but recorded a valid outcome",
    facts: deadHolder({
      files: {
        [OUTCOME]: JSON.stringify({
          version: 1,
          runId: RUN,
          finishedAt: "2026-10-17T00:00:00.000Z",
          childExit: { code: null, signal: "SIGKILL" },
          timedOut: true,
        }),
      },
    }),
    expected: { state: "dead", runId: RUN },
  },
  {
    name: "the terminal claim cannot be read",
    rule: "claim-unreadable",
    facts: deadHolder({ files: { [CLAIM]: { error: "EACCES" } } }),
    expected: stuck(RUN, "its terminal claim could not be read (EACCES)"),
  },
  {
    name: "the terminal claim is not JSON",
    rule: "claim-invalid",
    facts: deadHolder({ files: { [CLAIM]: "{" } }),
    expected: stuck(RUN, "its terminal claim is not valid JSON"),
  },
  {
    name: "the terminal claim names no claimant",
    rule: "claim-no-claimant",
    facts: deadHolder({ files: { [CLAIM]: "{}" } }),
    expected: stuck(RUN, "its terminal claim names no claimant"),
  },
  {
    name: "the publish claimant is alive",
    rule: "claimant-alive",
    facts: deadHolder({ pids: { [CLAIMANT]: "alive" } }),
    expected: { state: "live", runId: RUN },
  },
  {
    name: "the publish claimant cannot be checked",
    rule: "claimant-unknown",
    facts: deadHolder({ pids: { [CLAIMANT]: "unknown" } }),
    expected: stuck(RUN, `publish claimant pid ${CLAIMANT} could not be checked`),
  },
  {
    name: "no publish claim was made",
    facts: deadHolder({ files: { [CLAIM]: undefined } }),
    expected: { state: "dead", runId: RUN },
  },
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
    getPidLiveness: (pid) => facts.pids[pid] ?? "dead",
    getProcessStartIdentity: async (pid) => facts.starts[pid] ?? null,
  }
}

// The reaper's decision table (stale-lock-reaper.ts) over the same holder: one scenario per `rule:` tag.
const REAPER_NOW = Date.parse("2026-11-05T06:00:00.000Z")
const RUN_DIR = join(REFLECTION_DIR, "runs", RUN)
const LEDGER = join(RUN_DIR, "ledger.json")
const SUPERVISOR = 4201
const CHILD = 4202
const RESERVED_AT = new Date(REAPER_NOW - 10 * 60_000).toISOString()

function ledger(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    runId: RUN,
    kind: "reflection",
    trigger: "manual",
    startedAt: RESERVED_AT,
    hardDeadlineAt: 1_000,
    terminationGraceMs: 100,
    deadlineAt: 1_100,
    mergePolicy: "auto",
    pid: SUPERVISOR,
    processStart: null,
    childPid: CHILD,
    childProcessStart: null,
    worktreeDir: "/w",
    worktreeBranch: "b",
    baseSha: "0",
    gitFilePath: "/w/.git",
    gitFileSnapshot: "g",
    commonConfigPath: "/c",
    commonConfigSnapshot: null,
    ...fields,
  })
}

interface ReaperFacts extends Facts {
  readonly mtimes: Readonly<Record<string, number>>
}

export interface ReaperScenario {
  readonly name: string
  readonly rule?: string
  readonly facts: ReaperFacts
  readonly expected: StaleLockDecision
}

function stuckHolder(
  change: {
    files?: Record<string, FileState | undefined>
    pids?: Facts["pids"]
    starts?: Facts["starts"]
    mtimes?: Record<string, number>
  } = {},
): ReaperFacts {
  const files: Record<string, FileState> = {
    [LOCK]: lock({ reservedAt: RESERVED_AT, request: { trigger: "manual", conversationIds: [], snapshots: [] } }),
  }
  for (const [path, state] of Object.entries(change.files ?? {})) {
    if (state === undefined) delete files[path]
    else files[path] = state
  }
  return { files, pids: change.pids ?? {}, starts: change.starts ?? {}, mtimes: change.mtimes ?? {} }
}

const TORN_OLD = REAPER_NOW - 2 * 60 * 60_000
const STILL_LAUNCHING = {
  launching: true,
  pid: undefined,
  childPid: undefined,
  hardDeadlineAt: REAPER_NOW + 30 * 60_000,
  deadlineAt: REAPER_NOW + 30 * 60_000 + 100,
}
const LAUNCHING_LAPSED = { launching: true, pid: undefined, childPid: undefined }

const reap = (action: string, reason: string): StaleLockDecision =>
  ({ kind: "reap", action, runId: RUN, reason }) as StaleLockDecision
const kept = (runId: string, reason: string): StaleLockDecision => ({ kind: "stuck", runId, reason })

export const REAPER_SCENARIOS: readonly ReaperScenario[] = [
  { name: "no lock", facts: stuckHolder({ files: { [LOCK]: undefined } }), expected: { kind: "none" } },
  { name: "a live launcher", facts: stuckHolder({ pids: { [LAUNCHER]: "alive" } }), expected: { kind: "none" } },
  {
    name: "a dead holder with a recorded outcome",
    rule: "finalize",
    facts: { ...deadHolder(), mtimes: {} },
    expected: { kind: "finalize", runId: RUN },
  },
  {
    name: "a dead launcher still inside the launch window",
    rule: "launch-window",
    facts: stuckHolder({
      files: {
        [LOCK]: lock({
          reservedAt: new Date(REAPER_NOW - 20_000).toISOString(),
          request: { trigger: "manual", conversationIds: [], snapshots: [] },
        }),
      },
    }),
    expected: kept(RUN, "its launcher is gone but the launch window has not closed"),
  },
  {
    name: "a dead launcher with no ledger",
    rule: "launch-interrupted",
    facts: stuckHolder(),
    expected: reap("launch-interrupted", `launcher pid ${LAUNCHER} is gone and the run never started`),
  },
  {
    name: "a dead launcher whose run finished with a folded outcome",
    rule: "final-folded",
    facts: stuckHolder({
      files: {
        [join(RUN_DIR, "final.json")]: JSON.stringify({
          version: 1,
          runId: RUN,
          outcome: "merged",
          finishedAt: RESERVED_AT,
        }),
        [LEDGER]: ledger(),
      },
    }),
    expected: kept(RUN, "it finished with a folded outcome that only a session can settle; open a session"),
  },
  {
    name: "a dead launcher whose run finished with a failed outcome",
    rule: "terminal-recorded",
    facts: stuckHolder({
      files: {
        [join(RUN_DIR, "final.json")]: JSON.stringify({
          version: 1,
          runId: RUN,
          outcome: "failed",
          finishedAt: RESERVED_AT,
        }),
        [LEDGER]: ledger(),
      },
    }),
    expected: reap("terminal-recorded", "the run already recorded its terminal state"),
  },
  {
    name: "a dead launcher whose run was settled but not released",
    rule: "release-settled",
    facts: stuckHolder({
      files: {
        [join(RUN_DIR, "abandoned.json")]: JSON.stringify({ runId: RUN, generation: RESERVED_AT }),
        [LEDGER]: ledger(),
      },
    }),
    expected: reap("release-settled", "it was already settled and only the release is missing"),
  },
  {
    name: "a dead launcher whose run dir holds an older generation's record",
    rule: "settled-other-generation",
    facts: stuckHolder({ files: { [join(RUN_DIR, "abandoned.json")]: "{}", [LEDGER]: ledger() } }),
    expected: kept(RUN, "its run dir holds a terminal record from another generation"),
  },
  {
    name: "a dead launcher whose supervisor is alive",
    rule: "run-process-alive",
    facts: stuckHolder({
      files: { [LEDGER]: ledger({ processStart: RECORDED_START }) },
      pids: { [SUPERVISOR]: "alive" },
      starts: { [SUPERVISOR]: RECORDED_START },
    }),
    expected: kept(RUN, `its supervisor pid ${SUPERVISOR} is still running`),
  },
  {
    name: "a dead launcher whose child cannot be checked",
    facts: stuckHolder({ files: { [LEDGER]: ledger() }, pids: { [CHILD]: "unknown" } }),
    expected: kept(RUN, `its child pid ${CHILD} could not be checked`),
  },
  {
    name: "a dead launcher whose supervisor is still launching inside its hard deadline",
    rule: "run-launching",
    facts: stuckHolder({ files: { [LEDGER]: ledger(STILL_LAUNCHING) } }),
    expected: kept(RUN, "its supervisor is still launching and its hard deadline has not passed"),
  },
  {
    name: "a dead launcher whose ledger still says launching past its hard deadline",
    facts: stuckHolder({ files: { [LEDGER]: ledger(LAUNCHING_LAPSED) } }),
    expected: reap("processes-dead", "its launcher, supervisor and child are all gone and it recorded no outcome"),
  },
  {
    name: "a valid ledger whose processes are dead",
    rule: "processes-dead",
    facts: stuckHolder({ files: { [LEDGER]: ledger() } }),
    expected: reap("processes-dead", "its launcher, supervisor and child are all gone and it recorded no outcome"),
  },
  {
    name: "an unparseable ledger whose processes are dead",
    rule: "ledger-unreadable",
    facts: stuckHolder({ files: { [LEDGER]: ledger({ deadlineAt: 1 }) } }),
    expected: reap("ledger-unreadable", "its ledger cannot be read and its recorded processes are gone"),
  },
  {
    name: "a ledger that is not JSON whose pids cannot be read",
    facts: stuckHolder({ files: { [LEDGER]: "{ torn" } }),
    expected: reap("ledger-unreadable", "its ledger cannot be read and its recorded processes are gone"),
  },
  {
    name: "a torn active.lock and no live run",
    rule: "lock-torn",
    facts: stuckHolder({ files: { [LOCK]: '{"runId":' }, mtimes: { [LOCK]: TORN_OLD } }),
    expected: { kind: "reap", action: "lock-torn", runId: "unknown", reason: "active.lock is not valid JSON" },
  },
  {
    name: "a wrong-shape active.lock",
    facts: stuckHolder({ files: { [LOCK]: "null" }, mtimes: { [LOCK]: TORN_OLD } }),
    expected: { kind: "reap", action: "lock-torn", runId: "unknown", reason: "active.lock is not a reservation" },
  },
  {
    name: "a torn active.lock written ten minutes ago",
    rule: "torn-recent",
    facts: stuckHolder({ files: { [LOCK]: '{"runId":' }, mtimes: { [LOCK]: REAPER_NOW - 10 * 60_000 } }),
    expected: kept("unknown", "active.lock is not valid JSON and it is recent"),
  },
  {
    name: "a torn active.lock naming another host",
    rule: "torn-other-host",
    facts: stuckHolder({
      files: { [LOCK]: `{"runId":"${RUN}","launcherPid":${LAUNCHER},"launcherHostname":"other-host","laun` },
      mtimes: { [LOCK]: TORN_OLD },
    }),
    expected: kept("unknown", "active.lock is not valid JSON and its launcher is on host other-host"),
  },
  {
    name: "a torn active.lock whose launcher is alive",
    rule: "torn-launcher-alive",
    facts: stuckHolder({
      files: { [LOCK]: `{"runId":"${RUN}","launcherPid":${LAUNCHER},"launcherHostname":"${HOST}","laun` },
      pids: { [LAUNCHER]: "alive" },
      mtimes: { [LOCK]: TORN_OLD },
    }),
    expected: kept("unknown", `active.lock is not valid JSON and its launcher pid ${LAUNCHER} may still be alive`),
  },
  {
    name: "a torn active.lock cut inside its launcher hostname",
    rule: "torn-host-unknown",
    facts: stuckHolder({
      files: { [LOCK]: `{"runId":"${RUN}","launcherPid":${LAUNCHER},"launcherHostname":"thi` },
      mtimes: { [LOCK]: TORN_OLD },
    }),
    expected: kept("unknown", "active.lock is not valid JSON and its launcher host is unknown"),
  },
  {
    name: "a torn active.lock beside a run whose supervisor is still launching",
    rule: "torn-launching-run",
    facts: stuckHolder({
      files: { [LOCK]: "{", [LEDGER]: ledger(STILL_LAUNCHING) },
      mtimes: { [LOCK]: TORN_OLD, [RUN_DIR]: TORN_OLD },
    }),
    expected: kept("unknown", `active.lock is not valid JSON and run ${RUN} is still launching`),
  },
  {
    name: "a torn active.lock beside a run dir five minutes old",
    rule: "torn-young-run-dir",
    facts: stuckHolder({
      files: { [LOCK]: "{", [join(RUN_DIR, "prelaunch.json")]: "{}" },
      mtimes: { [LOCK]: TORN_OLD, [RUN_DIR]: REAPER_NOW - 5 * 60_000 },
    }),
    expected: kept("unknown", `active.lock is not valid JSON and run ${RUN} is a young run dir`),
  },
  {
    name: "a torn active.lock beside a run whose supervisor is alive",
    rule: "torn-live-run",
    facts: stuckHolder({
      files: { [LOCK]: "{", [LEDGER]: ledger() },
      pids: { [SUPERVISOR]: "alive" },
      mtimes: { [LOCK]: TORN_OLD, [RUN_DIR]: TORN_OLD },
    }),
    expected: kept("unknown", `active.lock is not valid JSON and run ${RUN} may still be live`),
  },
  {
    name: "a legacy reservation without launcher identity",
    rule: "legacy-lock",
    facts: stuckHolder({
      files: {
        [LOCK]: JSON.stringify({ runId: RUN, request: { trigger: "manual", conversationIds: [], snapshots: [] } }),
      },
    }),
    expected: kept(RUN, "its launcher identity is missing; a session reconciles it"),
  },
  {
    name: "another host",
    facts: stuckHolder({
      files: {
        [LOCK]: lock({
          launcherHostname: "other-host",
          request: { trigger: "manual", conversationIds: [], snapshots: [] },
        }),
      },
    }),
    expected: kept(RUN, "it is owned by host other-host, which cannot be checked from here"),
  },
]

export interface StrandedScenario {
  readonly name: string
  readonly rule?: string
  readonly facts: ReaperFacts
  readonly expected: StrandedRunDecision
}

const STRANDED = join(REFLECTION_DIR, "runs", "reflection-run-50")
const strandedFacts = (
  files: Record<string, FileState>,
  mtimes: Record<string, number> = {},
  pids: Facts["pids"] = {},
  starts: Facts["starts"] = {},
): ReaperFacts => ({ files, pids, starts, mtimes })

export const STRANDED_RUN_DIR = STRANDED

export const STRANDED_SCENARIOS: readonly StrandedScenario[] = [
  {
    name: "a bare dir inside the grace window",
    rule: "stranded-young",
    facts: strandedFacts({}, { [STRANDED]: REAPER_NOW - 2 * 60_000 }),
    expected: { kind: "keep", reason: "it is inside the launch grace window" },
  },
  {
    name: "a bare dir past the grace window",
    rule: "stranded-no-ledger",
    facts: strandedFacts({}, { [STRANDED]: REAPER_NOW - 20 * 60_000 }),
    expected: { kind: "reap", action: "no-ledger", reason: "it never got a ledger" },
  },
  {
    name: "a prelaunch.json that cannot be read",
    rule: "stranded-prelaunch-unreadable",
    facts: strandedFacts({ [join(STRANDED, "prelaunch.json")]: "{ torn" }, { [STRANDED]: REAPER_NOW - 20 * 60_000 }),
    expected: { kind: "keep", reason: "its prelaunch.json cannot be read" },
  },
  {
    name: "a prelaunch.json that names another run",
    rule: "stranded-prelaunch-mismatch",
    facts: strandedFacts(
      { [join(STRANDED, "prelaunch.json")]: JSON.stringify({ runId: "reflection-run-49" }) },
      { [STRANDED]: REAPER_NOW - 20 * 60_000 },
    ),
    expected: { kind: "keep", reason: "its prelaunch.json names another run" },
  },
  {
    name: "prelaunch.json only, past the grace window",
    facts: strandedFacts(
      { [join(STRANDED, "prelaunch.json")]: JSON.stringify({ runId: basename(STRANDED) }) },
      { [join(STRANDED, "prelaunch.json")]: REAPER_NOW - 20 * 60_000, [STRANDED]: REAPER_NOW },
    ),
    expected: { kind: "reap", action: "no-ledger", reason: "it never got a ledger" },
  },
  {
    name: "a ledger whose supervisor is alive",
    rule: "stranded-process-alive",
    facts: strandedFacts(
      { [join(STRANDED, "ledger.json")]: ledger({ runId: "reflection-run-50", processStart: RECORDED_START }) },
      {},
      { [SUPERVISOR]: "alive" },
      { [SUPERVISOR]: RECORDED_START },
    ),
    expected: { kind: "keep", reason: `its supervisor pid ${SUPERVISOR} is still running` },
  },
  {
    name: "a valid ledger still launching inside its hard deadline",
    rule: "stranded-launching",
    facts: strandedFacts({
      [join(STRANDED, "ledger.json")]: ledger({ runId: "reflection-run-50", ...STILL_LAUNCHING }),
    }),
    expected: { kind: "keep", reason: "its supervisor is still launching and its hard deadline has not passed" },
  },
  {
    name: "a valid ledger still marked launching past its hard deadline",
    facts: strandedFacts({
      [join(STRANDED, "ledger.json")]: ledger({ runId: "reflection-run-50", ...LAUNCHING_LAPSED }),
    }),
    expected: {
      kind: "reap",
      action: "processes-dead",
      reason: "its supervisor and child are gone and it recorded no outcome",
    },
  },
  {
    name: "a valid ledger whose processes are dead",
    rule: "stranded-processes-dead",
    facts: strandedFacts({ [join(STRANDED, "ledger.json")]: ledger({ runId: "reflection-run-50" }) }),
    expected: {
      kind: "reap",
      action: "processes-dead",
      reason: "its supervisor and child are gone and it recorded no outcome",
    },
  },
  {
    name: "an unreadable ledger whose processes are dead",
    rule: "stranded-ledger-unreadable",
    facts: strandedFacts({ [join(STRANDED, "ledger.json")]: "{ torn" }),
    expected: {
      kind: "reap",
      action: "ledger-unreadable",
      reason: "its ledger cannot be read and its recorded processes are gone",
    },
  },
]

export function reaperProbeFor(facts: ReaperFacts): StaleLockProbe {
  const base = probeFor(facts)
  return {
    ...base,
    now: () => REAPER_NOW,
    listDirectory: async (path) => {
      const prefix = `${path}${sep}`
      const names = new Set<string>()
      for (const file of [...Object.keys(facts.files), ...Object.keys(facts.mtimes)]) {
        if (file.startsWith(prefix)) {
          const rest = file.slice(prefix.length)
          const slash = rest.indexOf(sep)
          if (slash > 0) names.add(rest.slice(0, slash))
          else if (facts.mtimes[file] !== undefined && facts.files[file] === undefined) names.add(rest)
        }
      }
      return [...names].sort()
    },
    modifiedAt: async (path) => facts.mtimes[path] ?? REAPER_NOW,
  }
}
