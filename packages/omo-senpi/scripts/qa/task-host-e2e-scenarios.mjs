// Daemon fan-out and detach/attach scenarios for task-host-e2e.mjs (todo 41): A proves one daemon
// carries two parents' worth of children as sessions, B proves those sessions outlive their parent and
// are re-attached without replaying a prompt, I proves the default-mode rule both ways.
import { join } from "node:path"
import { singleParentPass } from "./task-host-e2e-gates.mjs"
import { STATE_DEADLINE_MS } from "./task-host-e2e-events.mjs"
import { terminalChildSnapshots } from "./task-host-e2e-stranded.mjs"
import { recordMockEvent } from "./task-host-e2e-audit.mjs"
export { scenarioB } from "./task-host-e2e-resume.mjs"

import { createScenarioSandbox, writeMockScript, writeOmoConfig } from "./task-host-e2e-sandbox.mjs"
import {
  cleanupScenario,
  daemonStatus,
  observeDaemon,
  perChildRpcProcesses,
  readTaskRecords,
  runBin,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"

/** The engine's own words about who serves the socket: what a parent printed about host/ensure/handoff. */
function hostLines(text) {
  const seen = new Set()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && /host|ensure|handoff|daemon|generation|socket/i.test(trimmed)) seen.add(trimmed.slice(0, 220))
  }
  return [...seen].slice(0, 12)
}
import {
  CHILD_BUSY,
  CHILD_DONE,
  CHILD_PROMPT,
  childSessionFiles,
  childStartDiagnosis,
  childrenSettled,
  failureTokens,
  hostConfig,
  holdParent,
  jsonlLines,
  recordFailureTokens,
  spawnScript,
  transcriptSizes,
} from "./task-host-e2e-support.mjs"

export async function scenarioA(run) {
  const sandbox = createScenarioSandbox(run, "sA", { omoConfig: hostConfig(), script: holdParent(spawnScript(16, CHILD_BUSY)) })
  const startedAt = Date.now()
  const parents = [0, 1].map(() => spawnParent(sandbox, run.mockEntry, "fan out sixteen daemon children", { capture: true }))
  const parentExits = []
  parents.forEach((parent, index) => {
    void parent.closed.then((closed) => parentExits.push({ parent: index, status: closed.status, signal: closed.signal, ms: Date.now() - startedAt }))
  })
  const watched = await observeDaemon(sandbox, (probe) => {
    if (probe.json?.sessions?.worker >= 32) return true
    return childrenSettled(readTaskRecords(sandbox), 32)
  // Allow a loaded host to open the full cohort; return as soon as the 32nd session lands.
  // The parents remain attached until observation, so graceful shutdown cannot cancel admission.
  }, { timeoutMs: 420_000, intervalMs: 1_000 })
  const observed = watched.matched ?? watched.lastProbe ?? daemonStatus(sandbox, { includeWorkers: true })
  const records = readTaskRecords(sandbox)
  const perChild = perChildRpcProcesses(sandbox)
  const parentOutput = parents.map((parent) => parent.chunks.stdout + parent.chunks.stderr).join("\n")
  const tokens = [...new Set([...failureTokens(parentOutput), ...recordFailureTokens(records)])]
  const facts = {
    sessionsTotal: observed.json?.sessions?.total ?? null,
    sessionsWorker: observed.json?.sessions?.worker ?? null,
    zombies: observed.json?.zombies ?? null,
    daemonPid: observed.json?.pid ?? null,
    instanceId: observed.json?.instanceId ?? null,
    perChildRpcProcessCount: perChild.length,
    failureTokens: tokens,
    terminalChildFailures: terminalChildSnapshots(sandbox).length,
    // Two parents concurrently ensure the same daemon. Record its identity throughout admission,
    // rather than trusting one final status call; parent exits and host diagnostics share that clock.
    daemonIdentityTimeline: watched.timeline,
    daemonIdentitiesSeen: [...new Set(watched.timeline.map((entry) => entry.instanceId).filter(Boolean))].length,
    parentExits,
    parentStderrHostLines: parents.map((parent) => hostLines(parent.chunks.stderr)),
    childStart: childStartDiagnosis(sandbox, records),
    // The store collapses every start failure to one fixed sentence, so when no child could start the
    // daemon itself is asked with the exact `open_session` the host runner issues, and its verbatim
    // refusal is recorded. Without it the evidence would name a symptom and not a cause.
    ...(records.some((record) => record.status === "error")
      ? {
          rootCause: await run.probeChildSessionOpen(
            join(sandbox.agentDir, "rpc", "rpc.sock"),
            sandbox.cwd,
            join(sandbox.stateDir, "sessions", "st_probe", "probe.jsonl"),
          ),
        }
      : {}),
  }
  const pass =
    facts.sessionsTotal >= 32 && facts.sessionsWorker >= 32 && tokens.length === 0 && perChild.length === 0 &&
    facts.daemonIdentitiesSeen === 1 && facts.terminalChildFailures === 0
  facts.driverTeardown = recordMockEvent(sandbox.cwd, { type: "driver_teardown", parentPids: parents.map((parent) => parent.child.pid) })
  for (const parent of parents) {
    try {
      process.kill(-parent.child.pid, "SIGKILL")
    } catch {
      // already gone
    }
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [facts.daemonPid].filter(Boolean) })
  return {
    scenario: "A",
    title: "one daemon, two parents x 16 process children",
    status: pass ? "pass" : "fail",
    reason: `sessions.total=${facts.sessionsTotal} sessions.worker=${facts.sessionsWorker} perChildRpc=${perChild.length} tokens=${tokens.length} daemonIdentities=${facts.daemonIdentitiesSeen} terminalFailures=${facts.terminalChildFailures}`,
    facts,
    receipt,
  }
}

/**
 * The control for A. A is the only scenario where TWO clients ensure the same daemon at once, so when A
 * reports the host being replaced under its children there are two candidate causes: concurrent ensures
 * racing each other, or a fan-out the daemon does not survive on its own. A1 is A with ONE parent: a
 * stable identity here blames the race, an unstable one exonerates it.
 */
export async function scenarioA1(run) {
  const sandbox = createScenarioSandbox(run, "sA1", { omoConfig: hostConfig(), script: holdParent(spawnScript(16, CHILD_BUSY, "s")) })
  const startedAt = Date.now()
  const parent = spawnParent(sandbox, run.mockEntry, "fan out sixteen daemon children from one parent", { capture: true })
  const parentExits = []
  void parent.closed.then((closed) => parentExits.push({ parent: 0, status: closed.status, signal: closed.signal, ms: Date.now() - startedAt }))
  const watched = await observeDaemon(sandbox, (probe) => {
    if (probe.json?.sessions?.worker >= 16) return true
    return childrenSettled(readTaskRecords(sandbox), 16)
  }, { timeoutMs: STATE_DEADLINE_MS, intervalMs: 1_000 })
  const observed = watched.matched ?? watched.lastProbe ?? daemonStatus(sandbox, { includeWorkers: true })
  const records = readTaskRecords(sandbox)
  const identities = [...new Set(watched.timeline.map((entry) => entry.instanceId).filter(Boolean))]
  const facts = {
    sessionsTotal: observed.json?.sessions?.total ?? null,
    sessionsWorker: observed.json?.sessions?.worker ?? null,
    daemonIdentityTimeline: watched.timeline,
    daemonIdentitiesSeen: identities.length,
    parentExits,
    parentStderrHostLines: hostLines(parent.chunks.stderr),
    perChildRpcProcessCount: perChildRpcProcesses(sandbox).length,
    failedChildren: records.filter((record) => ["error", "lost", "cancelled"].includes(record.status)).length,
    terminalChildFailures: terminalChildSnapshots(sandbox).length,
    childStart: childStartDiagnosis(sandbox, records),
  }
  const pass = singleParentPass(facts)
  facts.driverTeardown = recordMockEvent(sandbox.cwd, { type: "driver_teardown", parentPids: [parent.child.pid] })
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already gone
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [observed.json?.pid].filter(Boolean) })
  return {
    scenario: "A1",
    title: "single-parent control: 16 children, one daemon identity",
    status: pass ? "pass" : "fail",
    reason: `sessions.worker=${facts.sessionsWorker} daemonIdentities=${identities.length} perChildRpc=${facts.perChildRpcProcessCount} failedChildren=${facts.failedChildren} terminalFailures=${facts.terminalChildFailures}`,
    facts,
    receipt,
  }
}

export async function scenarioI(run) {
  const sandbox = createScenarioSandbox(run, "sI", { omoConfig: hostConfig(), script: spawnScript(1, CHILD_DONE, "auto") })
  const auto = runBin(sandbox, run.parentArgs(sandbox, "default mode child"), { timeoutMs: 180_000 })
  const autoRecords = readTaskRecords(sandbox)
  const autoRpc = perChildRpcProcesses(sandbox).length
  const autoStatus = daemonStatus(sandbox, { includeWorkers: true })
  writeOmoConfig(sandbox, hostConfig({ task: { default_execution_mode: "in-process" } }))
  writeMockScript(sandbox, spawnScript(1, CHILD_DONE, "inproc"))
  const inProcess = runBin(sandbox, run.parentArgs(sandbox, "in-process mode child"), { timeoutMs: 180_000 })
  const inProcessRecords = readTaskRecords(sandbox).filter((record) => record.name?.startsWith("inproc"))
  const facts = {
    autoExit: auto.status,
    autoExecutionModes: [...new Set(autoRecords.filter((r) => r.name?.startsWith("auto")).map((r) => r.execution_mode))],
    autoChildStatuses: autoRecords.filter((r) => r.name?.startsWith("auto")).map((r) => r.status),
    autoPerChildRpcProcesses: autoRpc,
    autoDaemonReachable: autoStatus.exitCode === 0,
    inProcessExit: inProcess.status,
    inProcessExecutionModes: [...new Set(inProcessRecords.map((record) => record.execution_mode))],
    inProcessStatuses: inProcessRecords.map((record) => record.status),
    childStart: childStartDiagnosis(sandbox, autoRecords.filter((record) => record.name?.startsWith("auto"))),
  }
  const autoOk = facts.autoExecutionModes.join() === "process" && autoRpc === 0 && facts.autoChildStatuses.every((s) => s === "completed")
  const inProcessOk = facts.inProcessExecutionModes.join() === "in-process" && facts.inProcessStatuses.every((s) => s === "completed")
  const receipt = await cleanupScenario(sandbox, { hostPids: [autoStatus.json?.pid].filter(Boolean) })
  return {
    scenario: "I",
    title: "default-mode rule: unset omo.json -> daemon sessions, in-process -> in-process",
    status: autoOk && inProcessOk ? "pass" : "fail",
    ...(autoOk && inProcessOk ? {} : { reason: `auto=${facts.autoExecutionModes.join()}/${facts.autoChildStatuses.join()} perChildRpc=${autoRpc} inProcess=${facts.inProcessExecutionModes.join()}/${facts.inProcessStatuses.join()}` }),
    facts,
    receipt,
  }
}
