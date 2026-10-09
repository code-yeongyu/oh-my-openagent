import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readRecords } from "./task-rpc-e2e-helpers.mjs"
import { killSenpiHost, waitForProcessCompletion, waitForRunningRpcChild } from "./task-rpc-e2e-scenarios.mjs"

function makeStateDir() {
  const stateDir = mkdtempSync(join(tmpdir(), "omo-rpc-wait-"))
  mkdirSync(join(stateDir, "tasks"), { recursive: true })
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  return stateDir
}

/** Writes a task record the way the store does: a complete file swapped in by rename. */
function writeRecord(stateDir, record) {
  const target = join(stateDir, "tasks", `${record.task_id}.json`)
  writeFileSync(`${target}.tmp`, JSON.stringify(record))
  renameSync(`${target}.tmp`, target)
}

const pendingRecord = { task_id: "t-pk", name: "pk", execution_mode: "process", status: "pending" }
const runningRecord = { ...pendingRecord, status: "running", pid: 4242 }

// The budgets are the behaviour under test here, so these tests run on real timers with short windows.
test("#given a cold parent that creates the task after the child-spawn window #when waiting #then the running child is still found", async () => {
  // given: the dev kill check waited one 40 s window from launch for a running child, so a parent
  // whose cold start alone outlasted it was reported as having no child
  const stateDir = makeStateDir()
  try {
    const waiting = waitForRunningRpcChild(stateDir, "pk", { parentTaskCreateMs: 10_000, childSpawnMs: 300 })
    const created = setTimeout(() => writeRecord(stateDir, pendingRecord), 600)
    const spawned = setTimeout(() => writeRecord(stateDir, runningRecord), 750)

    // when
    const running = await waiting
    clearTimeout(created)
    clearTimeout(spawned)

    // then
    expect(running).toMatchObject({ task_id: "t-pk", status: "running", pid: 4242 })
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("#given a task whose child never starts #when waiting #then it gives up after the child-spawn window, not the parent window", async () => {
  // given
  const stateDir = makeStateDir()
  writeRecord(stateDir, pendingRecord)
  try {
    const startedAt = Date.now()

    // when
    const running = await waitForRunningRpcChild(stateDir, "pk", { parentTaskCreateMs: 30_000, childSpawnMs: 200 })

    // then
    expect(running).toBeUndefined()
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("#given a parent that never creates the task #when waiting #then it reports no child once the parent window ends", async () => {
  // given
  const stateDir = makeStateDir()
  try {
    // when
    const running = await waitForRunningRpcChild(stateDir, "pk", { parentTaskCreateMs: 200, childSpawnMs: 30_000 })

    // then
    expect(running).toBeUndefined()
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("#given a live Senpi QA host #when it is killed #then teardown routes through tree termination", async () => {
  const calls = []
  const child = { pid: 5151, exitCode: null, signalCode: null }

  const killed = await killSenpiHost(child, async (pid) => {
    calls.push(pid)
    return true
  })

  expect(killed).toBe(true)
  expect(calls).toEqual([5151])
})

test("#given an exited Senpi QA host #when cleanup repeats #then no recycled pid is terminated", async () => {
  const calls = []
  const child = { pid: 5151, exitCode: 0, signalCode: null }

  const killed = await killSenpiHost(child, async (pid) => {
    calls.push(pid)
    return true
  })

  expect(killed).toBe(true)
  expect(calls).toEqual([])
})

const runningProcessTask = { task_id: "t-done", name: "done", execution_mode: "process", status: "running", pid: 4343 }

test("#given the parent session returned before its child's completion write #when the completion check runs #then it sees the completion that a single read misses", async () => {
  // given: the record still says running when the check starts (#9481)
  const stateDir = makeStateDir()
  try {
    writeRecord(stateDir, runningProcessTask)
    const singleRead = readRecords(stateDir).some((r) => r.status === "completed" && r.execution_mode === "process")

    // when: the check starts waiting, and only then does the child's completion land
    const waiting = waitForProcessCompletion(stateDir, 10_000)
    writeRecord(stateDir, { ...runningProcessTask, status: "completed" })

    // then: the old single read reported no completion; the wait reports it
    expect(singleRead).toBe(false)
    expect(await waiting).toEqual({ completed: true })
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("#given a child that never completes #when the completion check waits #then it fails at its deadline and reports the last status", async () => {
  // given
  const stateDir = makeStateDir()
  try {
    writeRecord(stateDir, runningProcessTask)

    // when
    const result = await waitForProcessCompletion(stateDir, 300)

    // then
    expect(result).toEqual({ completed: false, lastStatuses: ["running"] })
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})
