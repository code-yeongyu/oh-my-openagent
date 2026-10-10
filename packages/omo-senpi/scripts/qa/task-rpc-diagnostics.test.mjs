import { expect, jest, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureChild, dumpRunProcesses, OUTPUT_TAIL_LIMIT, stageRecorder, withinDeadline } from "./task-rpc-diagnostics.mjs"
import { runReconcileCheck } from "./task-rpc-e2e-scenarios.mjs"
import { waitForRecord } from "./task-rpc-record-wait.mjs"
import { summarizeRuns } from "./task-rpc-reconcile-batch.mjs"

test("a failed initial parent exits promptly with its stderr and last stage", async () => {
  // Given a Bun executable receiving Senpi-only arguments, the parent really fails to launch.
  const stages = []
  const result = await runReconcileCheck(process.execPath, { onStage: (stage) => stages.push(stage) })
  // Then a dead parent cannot consume the 120-second task-creation budget.
  expect(result.verdict).toBe("FAIL")
  expect(result.reason).toBe("parent exited before RPC child became running")
  expect(result.facts.parent.status).not.toBe(0)
  expect(result.facts.parent.stderrTail.length).toBeGreaterThan(0)
  expect(stages.map((stage) => stage.stage)).toEqual(["parent_spawned"])
  expect(existsSync(result.facts.sandboxRoot)).toBe(false)
}, 20_000)

test("captured child output retains both bounded tails through actual exit", async () => {
  const child = spawn(process.execPath, ["-e", `process.stdout.write("x".repeat(20000)+"OUT"); process.stderr.write("y".repeat(20000)+"ERR")`], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let updates = 0
  const capture = captureChild(child, () => { updates += 1 })
  const result = await capture.closed
  expect(result.status).toBe(0)
  expect(result.stdoutTail).toBe("x".repeat(OUTPUT_TAIL_LIMIT - 3) + "OUT")
  expect(result.stderrTail).toBe("y".repeat(OUTPUT_TAIL_LIMIT - 3) + "ERR")
  expect(capture.signal.aborted).toBe(true)
  expect(updates).toBeGreaterThan(0)
})

test("a pre-kill dump names the still-running process and its open descriptors", async () => {
  const child = spawn(process.execPath, ["-e", 'console.log("READY"); setInterval(() => {}, 1000)'], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const capture = captureChild(child)
  const ready = new Promise((resolve) => child.stdout.once("data", resolve))
  try {
    await ready
    const dump = await dumpRunProcesses([child.pid])
    if (process.platform === "win32") expect(dump.tasklist.stdout).toContain(String(child.pid))
    else {
      expect(dump.processes.some((row) => row.pid === child.pid)).toBe(true)
      expect(dump.sockets.find((row) => row.pid === child.pid)?.stdout).toContain(String(child.pid))
    }
    expect(child.exitCode).toBeNull()
  } finally {
    child.kill("SIGKILL")
    await capture.closed
  }
}, 20_000)

test("watchdog awaits its dump before rejecting and clears its timer", async () => {
  jest.useFakeTimers()
  const entered = Promise.withResolvers()
  const dumped = Promise.withResolvers()
  const lateExit = Promise.withResolvers()
  const order = []
  try {
    const deadline = withinDeadline(lateExit.promise, 360_000, async () => {
      order.push("dump_started")
      entered.resolve()
      await dumped.promise
      order.push("dump_saved")
      order.push("kill")
    })
    const observed = deadline.catch((error) => error)
    jest.advanceTimersByTime(359_999)
    expect(order).toEqual([])
    jest.advanceTimersByTime(1)
    await entered.promise
    expect(order).toEqual(["dump_started"])
    lateExit.resolve("exited while diagnostics were being collected")
    await lateExit.promise
    dumped.resolve()
    expect(await observed).toBeInstanceOf(Error)
    expect(order).toEqual(["dump_started", "dump_saved", "kill"])
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    dumped.resolve()
    jest.useRealTimers()
  }
})

test("early process exit cancels record watchers and their deadline", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-rpc-abort-"))
  mkdirSync(join(root, "tasks"))
  mkdirSync(join(root, "logs"))
  const controller = new AbortController()
  jest.useFakeTimers()
  try {
    const waiting = waitForRecord(root, () => false, 120_000, controller.signal)
    controller.abort()
    expect(await waiting).toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    controller.abort()
    jest.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  }
})

test("stage receipts and min-of-N retain slow and failed control runs", () => {
  const stages = stageRecorder(() => {})
  stages.mark("parent_spawned", { pid: 42 })
  stages.mark("task_created", { taskId: "st_test" })
  expect(stages.stages[1].elapsedMs).toBeGreaterThanOrEqual(stages.stages[0].elapsedMs)
  const summary = summarizeRuns([
    { label: "A1", elapsedMs: 10, verdict: "PASS", stages: stages.stages, cpu: [{ values: [20] }] },
    { label: "B1", elapsedMs: 30, verdict: "PASS", stages: [], cpu: [{ values: [40] }] },
    { label: "B2", elapsedMs: 300, verdict: "FAIL", stages: [], cpu: [{ values: [90] }] },
  ])
  expect(summary[1]).toMatchObject({ runs: 2, passed: 1, minMs: 30, maxMs: 300, fseventsdMinCpu: 40, fseventsdMaxCpu: 90 })
})
