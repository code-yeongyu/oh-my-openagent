// Scenario K (senpi#1905 S2): host threads return to baseline after its children close.
//
// Each open session costs the host ~1 thread (the config-reload watch Worker, senpi#1794) - by
// design. What senpi#1905 fixed is that a torn-down session did NOT give its thread back: the
// provider scope closed beside a still-running disposal, the watch engine was never closed, and
// hosts accumulated 70-185 threads over hours before the runtime died in a Worker/GC thread.
// Sixteen children run to completion on one daemon; once every child record is terminal and the
// host is idle, its thread count must be back within a small tolerance of the pre-fan-out count.
import { execFileSync } from "node:child_process"

import { generationHostPid } from "./task-host-e2e-daemon-state.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { cleanupScenario, daemonStatus, pidAlive, readTaskRecords, spawnParent, waitFor } from "./task-host-e2e-process.mjs"
import { createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import { CHILD_BUSY, childStartDiagnosis, childrenSettled, hostConfig, holdParent, spawnScript } from "./task-host-e2e-support.mjs"

const CHILDREN = 16
/** Threads the host may keep above its pre-fan-out count once every child is gone (GC/JIT helpers settle slowly). */
const THREAD_TOLERANCE = 4
/** Resident memory the host may keep above its pre-fan-out RSS, in MB. */
const RSS_TOLERANCE_MB = 512

/** Thread count of one pid, darwin `ps -M` (one row per thread) or linux `nlwp=`. */
export function threadCount(pid) {
  try {
    if (process.platform === "darwin") {
      const rows = execFileSync("ps", ["-M", "-p", String(pid)], { encoding: "utf8" }).trim().split("\n")
      return Math.max(0, rows.length - 1)
    }
    return Number(execFileSync("ps", ["-o", "nlwp=", "-p", String(pid)], { encoding: "utf8" }).trim())
  } catch {
    return undefined
  }
}

export function rssMb(pid) {
  try {
    return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024)
  } catch {
    return undefined
  }
}

export async function scenarioK(run) {
  const sandbox = createScenarioSandbox(run, "sK", {
    omoConfig: hostConfig(),
    script: holdParent(spawnScript(CHILDREN, CHILD_BUSY, "k")),
  })
  // The daemon is ensured by the parent, so the baseline is the host right after it comes up and
  // before the fan-out lands: sampled at the first task record.
  let parent
  let baseline
  const started = await observeState(
    sandbox.root,
    () => {
      const records = readTaskRecords(sandbox)
      if (baseline === undefined && records.length > 0) {
        const pid = generationHostPid(sandbox.agentDir)
        if (pid !== undefined) baseline = { pid, threads: threadCount(pid), rssMb: rssMb(pid), atChildren: records.length }
      }
      return childrenSettled(records, CHILDREN) ? records : undefined
    },
    { trigger: () => { parent = spawnParent(sandbox, run.mockEntry, "run sixteen children to completion", { capture: true }) } },
  )
  const records = started ?? readTaskRecords(sandbox)
  const hostPid = generationHostPid(sandbox.agentDir)
  const peak = hostPid === undefined ? undefined : { threads: threadCount(hostPid), rssMb: rssMb(hostPid) }
  await stopParent(parent)

  // Threads go when the session is disposed and the Worker terminates; give the host a bounded window.
  const settled =
    hostPid === undefined || baseline === undefined
      ? undefined
      : await waitFor(
          () => {
            if (!pidAlive(hostPid)) return undefined
            const threads = threadCount(hostPid)
            return threads !== undefined && threads <= baseline.threads + THREAD_TOLERANCE ? threads : undefined
          },
          { timeoutMs: 90_000, intervalMs: 2_000 },
        )
  const after = hostPid === undefined ? undefined : { threads: threadCount(hostPid), rssMb: rssMb(hostPid) }
  const status = daemonStatus(sandbox, { includeWorkers: true })
  const facts = {
    hostPid: hostPid ?? null,
    sameHostThroughout: baseline?.pid === hostPid,
    daemonAlive: hostPid !== undefined && pidAlive(hostPid) && status.exitCode === 0,
    childrenStarted: records.length,
    childrenCompleted: records.filter((record) => record.status === "completed").length,
    baseline: baseline ?? null,
    peak: peak ?? null,
    after: after ?? null,
    threadsReturnedToBaseline: settled !== undefined,
    threadDelta: after?.threads !== undefined && baseline?.threads !== undefined ? after.threads - baseline.threads : null,
    rssDeltaMb: after?.rssMb !== undefined && baseline?.rssMb !== undefined ? after.rssMb - baseline.rssMb : null,
    sessionsRemaining: status.json?.sessions?.total ?? null,
    childStart: childStartDiagnosis(sandbox, records),
  }
  const pass =
    facts.sameHostThroughout &&
    facts.daemonAlive &&
    facts.childrenCompleted === CHILDREN &&
    facts.threadsReturnedToBaseline &&
    facts.rssDeltaMb !== null &&
    facts.rssDeltaMb <= RSS_TOLERANCE_MB
  const receipt = await cleanupScenario(sandbox, { hostPids: [hostPid, status.json?.pid].filter(Boolean) })
  return {
    scenario: "K",
    title: "host threads and RSS return to baseline after sixteen children close",
    status: pass ? "pass" : "fail",
    reason: `completed=${facts.childrenCompleted} threads base=${baseline?.threads ?? "?"} peak=${peak?.threads ?? "?"} after=${after?.threads ?? "?"} (delta ${facts.threadDelta}) rss base=${baseline?.rssMb ?? "?"}MB after=${after?.rssMb ?? "?"}MB (delta ${facts.rssDeltaMb}) sameHost=${facts.sameHostThroughout}`,
    facts,
    receipt,
  }
}
