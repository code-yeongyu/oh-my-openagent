import { homedir } from "node:os"
import { join } from "node:path"

import { evaluateDaemonStaleness } from "../codegraph/daemon-lock"
import { codegraphDataRoot } from "../codegraph/paths"
import { selectZombieCodegraphProcesses, type CodegraphZombieProcess } from "./codegraph-family"
import {
  runProcessFamilySweep,
  type ProcessFamilySweepOptions,
  type ProcessFamilySweepResult,
  type ProcessSweepAction,
} from "./family-sweeper"
import { enumerateProcesses } from "./exec"
import type { ProcessInfo } from "./process-table"
import { discoverCodegraphOwnedRoots, type CodegraphOwnedRootsOptions } from "./roots"

export type CodegraphSweepAction = ProcessSweepAction

export interface SweepCodegraphZombiesOptions extends CodegraphOwnedRootsOptions, ProcessFamilySweepOptions {
  readonly ownedRoots?: readonly string[]
  readonly processProvider?: () => Promise<readonly ProcessInfo[]>
}

export interface SweepCodegraphZombiesResult extends ProcessFamilySweepResult<CodegraphZombieProcess> {
  readonly daemonAction: ProcessSweepAction
  readonly daemonStampFile: string
  readonly ownedRoots: readonly string[]
  readonly workerAction: ProcessSweepAction
  readonly workerStampFile: string
}

// Keep the legacy daemon stamp name so existing installs retain their cadence.
// Worker selection is cheap and bypasses its stamp on every hook invocation.
const CODEGRAPH_DAEMON_SWEEP_STAMP_FILE = "zombie-sweep.stamp"
const CODEGRAPH_WORKER_SWEEP_STAMP_FILE = "worker-sweep.stamp"

export async function sweepCodegraphZombies(options: SweepCodegraphZombiesOptions = {}): Promise<SweepCodegraphZombiesResult> {
  const homeDir = options.homeDir ?? options.env?.["HOME"] ?? options.env?.["USERPROFILE"] ?? homedir()
  const dataRoot = codegraphDataRoot(homeDir)
  const daemonStampFile = join(dataRoot, CODEGRAPH_DAEMON_SWEEP_STAMP_FILE)
  const workerStampFile = join(dataRoot, CODEGRAPH_WORKER_SWEEP_STAMP_FILE)
  const ownedRoots = options.ownedRoots ?? discoverCodegraphOwnedRoots(options)
  const provider = options.processProvider ?? (() => enumerateProcesses(options.platform))
  let candidatesPromise: Promise<readonly CodegraphZombieProcess[]> | undefined
  const collectCandidates = (): Promise<readonly CodegraphZombieProcess[]> => {
    candidatesPromise ??= provider().then((processes) => selectZombieCodegraphProcesses(processes, {
      ownedRoots,
      ...(options.platform === undefined ? {} : { platform: options.platform }),
    }))
    return candidatesPromise
  }

  const [workerResult, daemonResult] = await Promise.all([
    runProcessFamilySweep<CodegraphZombieProcess>(
      {
        familyLabel: "CodeGraph worker sweep",
        stampFile: workerStampFile,
        collect: async () => {
          const candidates = (await collectCandidates()).filter((candidate) => candidate.matchKind !== "upstream-daemon")
          return { candidates, killList: candidates, spared: [] }
        },
      },
      { ...options, force: true },
    ),
    runProcessFamilySweep<CodegraphZombieProcess>(
      {
        familyLabel: "CodeGraph daemon sweep",
        stampFile: daemonStampFile,
        collect: async () => {
          const candidates = (await collectCandidates()).filter((candidate) => candidate.matchKind === "upstream-daemon")
          const { killList, spared } = partitionByDaemonStaleness(candidates, options.log)
          return { candidates, killList, spared }
        },
      },
      options,
    ),
  ])

  return {
    action: aggregateAction(workerResult.action, daemonResult.action),
    candidates: [...workerResult.candidates, ...daemonResult.candidates],
    daemonAction: daemonResult.action,
    daemonStampFile,
    dryRun: options.dryRun === true,
    failed: [...workerResult.failed, ...daemonResult.failed],
    killed: [...workerResult.killed, ...daemonResult.killed],
    ownedRoots,
    spared: daemonResult.spared,
    stampFile: daemonStampFile,
    workerAction: workerResult.action,
    workerStampFile,
  }
}

/** Detached daemon candidates are killed only when their project lock proves staleness. */
function partitionByDaemonStaleness(
  candidates: readonly CodegraphZombieProcess[],
  log: ((message: string) => void) | undefined,
): { readonly killList: readonly CodegraphZombieProcess[]; readonly spared: readonly CodegraphZombieProcess[] } {
  const killList: CodegraphZombieProcess[] = []
  const spared: CodegraphZombieProcess[] = []
  for (const candidate of candidates) {
    const staleness = evaluateDaemonStaleness(candidate.pid, candidate.daemonProjectRoot ?? candidate.matchedRoot)
    if (staleness.stale) {
      log?.(`CodeGraph daemon sweep sweeping stale daemon pid ${candidate.pid} (${staleness.reason})`)
      killList.push(candidate)
      continue
    }
    log?.(`CodeGraph daemon sweep spared live daemon pid ${candidate.pid} (${staleness.reason})`)
    spared.push(candidate)
  }
  return { killList, spared }
}

function aggregateAction(workerAction: ProcessSweepAction, daemonAction: ProcessSweepAction): ProcessSweepAction {
  if (workerAction === "failed" || daemonAction === "failed") return "failed"
  if (workerAction === "swept" || daemonAction === "swept") return "swept"
  return "throttled"
}
