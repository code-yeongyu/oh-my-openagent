import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { prepareScenarioSandbox, driveSenpiAsync, cleanupSenpiHost, hangingChildSteps } from "./task-rpc-e2e-scenarios.mjs"
import { parseEvents, readRecords, readTaskEventTypes, pidAlive } from "./task-rpc-e2e-helpers.mjs"
import { waitForRecord, waitForRunningRpcChild } from "./task-rpc-record-wait.mjs"
import { captureChild, dumpRunProcesses, RELAUNCH_TIMEOUT_MS, stageRecorder, withinDeadline } from "./task-rpc-diagnostics.mjs"

const CONFIG = {
  task: { default_execution_mode: "process", process_runner: "child-process", reattach_on_reconcile: false },
  categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } },
}

function readTaskEvents(stateDir, taskId) {
  try {
    return parseEvents(readFileSync(join(stateDir, "logs", `${taskId}.jsonl`), "utf8"))
  } catch (error) {
    return { readError: String(error) }
  }
}

export async function runReconcileCheck(senpiBin, options = {}) {
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox(CONFIG)
  const stages = stageRecorder(options.onStage)
  const hosts = []
  const captures = []
  const observing = new AbortController()
  const facts = { sandboxRoot: sandbox.root, stages: stages.stages }
  let orphanPid
  const launch = (steps, childSteps, prompt) => {
    const child = driveSenpiAsync(senpiBin, sandbox, sessionDir, steps, childSteps, prompt, true)
    hosts.push(child)
    const capture = captureChild(child, () => options.onOutput?.(captures.map((entry) => entry.snapshot())))
    captures.push(capture)
    return { child, capture }
  }
  const diagnostics = () => ({
    ...facts, parent: captures[0]?.snapshot(), relaunch: captures[1]?.snapshot(),
  })
  try {
    const parent = launch(hangingChildSteps("pr"), [{ type: "hang" }], "drive the reconcile scenario")
    facts.parentPid = parent.child.pid
    stages.mark("parent_spawned", { pid: parent.child.pid, sandboxRoot: sandbox.root })
    const running = await waitForRunningRpcChild(stateDir, "pr", {
      ...options.budgets, signal: parent.capture.signal,
      onCreated: (record) => stages.mark("task_created", { taskId: record.task_id }),
    })
    if (running === undefined) {
      if (!parent.capture.signal.aborted) {
        facts.timeoutDump = await dumpRunProcesses([parent.child.pid], sandbox.root)
        stages.mark("parent_wait_timeout", { dump: facts.timeoutDump })
      }
      return {
        check: "reconcile_lost_terminates_orphan", verdict: "FAIL",
        reason: parent.capture.signal.aborted ? "parent exited before RPC child became running" : "no running rpc child appeared to reconcile",
        facts: diagnostics(),
      }
    }
    orphanPid = running.pid
    facts.orphanPid = orphanPid
    facts.runningRecord = running
    stages.mark("rpc_child_running", { pid: orphanPid, hostPid: running.host_pid })
    if (parent.capture.signal.aborted) throw new Error("parent exited before crash injection")
    await cleanupSenpiHost(parent.child)
    stages.mark("parent_killed", { pid: parent.child.pid })
    facts.afterCrashRecord = readRecords(stateDir).find((r) => r.task_id === running.task_id)
    facts.ownerAliveAfterCrash = typeof running.host_pid === "number" && pidAlive(running.host_pid)

    // Subscribe before launch: even a one-response parent can reconcile and exit between reads.
    const reconciled = waitForRecord(stateDir, (record) =>
      record.task_id === running.task_id && record.status === "lost"
        && readTaskEventTypes(stateDir, running.task_id).includes("reconcile_lost"),
    options.relaunchTimeoutMs ?? RELAUNCH_TIMEOUT_MS, observing.signal).then((record) => {
      if (record !== undefined) stages.mark("reconcile_done", { taskId: record.task_id })
      return record
    })
    stages.mark("relaunch_started")
    const relaunch = launch(
      [{ type: "text", text: "reconcile relaunch complete" }],
      [{ type: "text", text: "omo rpc child mock work complete" }],
      "relaunch for reconcile",
    )
    facts.relaunchPid = relaunch.child.pid
    const exit = await withinDeadline(relaunch.capture.closed, options.relaunchTimeoutMs ?? RELAUNCH_TIMEOUT_MS, async () => {
      facts.timeoutDump = await dumpRunProcesses(hosts.map((host) => host.pid), sandbox.root)
      stages.mark("relaunch_timeout", {
        dump: facts.timeoutDump, parent: parent.capture.snapshot(), relaunch: relaunch.capture.snapshot(),
      })
      await cleanupSenpiHost(relaunch.child)
    })
    observing.abort()
    await reconciled
    const latest = readRecords(stateDir).find((r) => r.task_id === running.task_id)
    const eventTypes = readTaskEventTypes(stateDir, running.task_id)
    if (latest?.status === "lost" && eventTypes.includes("reconcile_lost")
      && !stages.stages.some((entry) => entry.stage === "reconcile_done")) {
      stages.mark("reconcile_done", { taskId: running.task_id, source: "exit_readback" })
    }
    stages.mark("relaunch_exited", { pid: relaunch.child.pid, status: exit.status, signal: exit.signal })
    const orphanDead = pidAlive(orphanPid) === false
    const pass = exit.status === 0 && latest?.status === "lost" && eventTypes.includes("reconcile_lost") && orphanDead
    Object.assign(facts, {
      orphanDead, ownerAliveAfterRelaunch: typeof running.host_pid === "number" && pidAlive(running.host_pid),
      finalRecord: latest, events: readTaskEvents(stateDir, running.task_id), status: latest?.status,
      error_message: latest?.error_message, failure_kind: latest?.failure_kind,
      failure_reason: latest?.failure_reason, killed: latest?.killed, eventTypes,
      breadcrumb: (latest?.error_message ?? "").slice(0, 120),
    })
    return {
      check: "reconcile_lost_terminates_orphan", verdict: pass ? "PASS" : "FAIL",
      ...(pass ? {} : { reason: `relaunchOk=${exit.status === 0} lostRecord=${latest?.status === "lost"} lostEvent=${eventTypes.includes("reconcile_lost")} orphanDead=${orphanDead}` }),
      facts: diagnostics(),
    }
  } catch (error) {
    return { check: "reconcile_lost_terminates_orphan", verdict: "FAIL", reason: String(error), facts: diagnostics() }
  } finally {
    observing.abort()
    try {
      for (const host of hosts) await cleanupSenpiHost(host)
      if (typeof orphanPid === "number" && pidAlive(orphanPid)) {
        try { process.kill(orphanPid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
      }
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
  }
}
