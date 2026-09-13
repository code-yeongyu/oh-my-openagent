#!/usr/bin/env bun
// Live QA for DAG recovery across a host handoff (omo-desktop RPC restart shape). Drives the REAL
// surfaces end to end: a real on-disk DagFileStore, the real shutdown pause write, a genuinely
// spawned OS process standing in for the predecessor host that is still exiting, the assembled
// dag-runtime with its default signal-0 liveness probe and real timers, and the real journal. The
// run must stay paused while the predecessor pid lives and resume by itself once it is gone, with
// no second session start. Writes the report to <out-dir> and exits non-zero on any violation.
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec, RunnerOutcome } from "@oh-my-opencode/senpi-task"
import { createDagFileStore, createDagManager, type DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { createDagRuntime } from "../../src/components/task/dag-runtime"
import { composeTaskEngine } from "../../src/components/task/engine"

const RUN_ID = "run-lease-handoff" as DagRunId
const SESSION_ID = "session-lease-handoff"
const POLL_MS = 100

const outDir = process.argv[2] ?? join(tmpdir(), "dag-lease-handoff-qa")
const failures: string[] = []
const report: Record<string, unknown> = {}

function check(name: string, condition: boolean, detail: unknown): void {
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`)
}

class CompletingRunner implements ManagedRunner {
  started = 0

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.started += 1
    const outcome: RunnerOutcome = { status: "completed", finalResponse: `qa output for ${spec.taskId}` }
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => Promise.resolve(outcome),
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    })
  }
}

function assembleRuntime(cwd: string, runner: CompletingRunner, warnings: unknown[]) {
  const pi = new FakeExtensionAPI()
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  engine.runtime.captureFrom({ sessionManager: { getSessionId: () => SESSION_ID } })
  return createDagRuntime({
    pi,
    engine,
    logger: {
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...fields }),
      error: (message: string, fields?: Record<string, unknown>) => warnings.push({ level: "error", message, ...fields }),
    },
    leaseWatch: { intervalMs: POLL_MS },
  })
}

const root = fs.mkdtempSync(join(tmpdir(), "dag-lease-handoff-qa-"))
const predecessor = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })
await new Promise((resolve) => setTimeout(resolve, 200))
const predecessorPid = predecessor.pid
if (predecessorPid === undefined) throw new Error("QA could not spawn a predecessor host")

try {
  const store = createDagFileStore({ project_dir: root })
  await createDagManager({ store, newRunId: () => RUN_ID }).start({
    parentSessionId: SESSION_ID,
    rootSessionId: SESSION_ID,
    definition: {
      key: "lease-handoff-qa",
      name: "lease handoff",
      nodes: [{ id: "resume", prompt: "resume", subagent_type: "explore", model: "omo-mock/mock-1" }],
    },
  })

  // The predecessor host pauses the run for its shutdown; its pid is the recorded previous holder.
  const predecessorWarnings: unknown[] = []
  const predecessorRuntime = assembleRuntime(root, new CompletingRunner(), predecessorWarnings)
  await predecessorRuntime.pauseForShutdown()
  predecessorRuntime.dispose()
  store.withRunLock(RUN_ID, () => {
    const fresh = store.readCheckpoint<Record<string, unknown>>(RUN_ID)
    store.writeCheckpoint(RUN_ID, { ...fresh, previousLeaseHolderPid: predecessorPid })
  })
  const paused = store.readCheckpoint<{ readonly status: string; readonly previousLeaseHolderPid?: number }>(RUN_ID)
  check("shutdown pause parks the run", paused?.status === "paused", paused?.status)
  check("predecessor pid is the recorded holder", paused?.previousLeaseHolderPid === predecessorPid, paused)

  // The successor host resumes the session while the predecessor is still alive.
  const runner = new CompletingRunner()
  const warnings: unknown[] = []
  const successor = assembleRuntime(root, runner, warnings)
  await successor.attach()
  const afterAttach = store.readCheckpoint<{ readonly status: string }>(RUN_ID)
  report.status_after_attach = afterAttach?.status
  report.warnings_after_attach = warnings
  check("run stays paused while the predecessor lives", afterAttach?.status === "paused", afterAttach?.status)
  check("no child started while the predecessor lives", runner.started === 0, runner.started)
  check("deferral is logged with the holder pid", warnings.some((entry) =>
    typeof entry === "object" && entry !== null && "holderPid" in entry && entry.holderPid === predecessorPid), warnings)

  // Hold the predecessor across several polls: the watch must never claim early.
  await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4))
  const heldStatus = store.readCheckpoint<{ readonly status: string }>(RUN_ID)?.status
  report.status_while_held = heldStatus
  check("run still paused across polls while the predecessor lives", heldStatus === "paused", heldStatus)

  // The predecessor exits; the successor must resume the run with no further session start.
  const exited = new Promise((resolve) => predecessor.once("exit", resolve))
  predecessor.kill("SIGKILL")
  await exited
  const result = await Promise.race([
    successor.wait(RUN_ID, SESSION_ID),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("run did not resume within 10s")), 10_000)),
  ])
  const events = store.readEvents(RUN_ID, 0, { limit: 100 }).events
  report.resumed_seq = events.find((event) => event.type === "dag.run.resumed")?.seq
  report.final_status = result.status
  report.children_started = runner.started
  check("run resumed after the predecessor exited", report.resumed_seq !== undefined, events.map((event) => event.type))
  check("run completed through the successor", result.status === "completed", result.status)
  check("exactly one child ran the pending node", runner.started === 1, runner.started)
  successor.dispose()

  report.predecessor_pid = predecessorPid
  report.state_dir = store.stateDir
  report.failures = failures
  report.result = failures.length === 0 ? "PASS" : "FAIL"

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(join(outDir, "dag-lease-handoff-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (predecessor.exitCode === null) predecessor.kill("SIGKILL")
  fs.rmSync(root, { recursive: true, force: true })
}

process.exit(failures.length === 0 ? 0 : 1)
