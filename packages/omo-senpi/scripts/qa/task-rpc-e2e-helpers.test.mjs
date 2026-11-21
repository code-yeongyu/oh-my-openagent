import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"

import { pidAlive, survivingRecordedChildren } from "./task-rpc-e2e-helpers.mjs"
import { readProcessStartMs } from "./task-rpc-process-start.mjs"

async function withLiveProcess(run) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
    stdio: "ignore",
    windowsHide: true,
  })
  await once(child, "spawn")
  try {
    return await run(child.pid)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit")
      child.kill("SIGKILL")
      await exited
    }
  }
}

const rpcRecord = (pid, updatedAt) => ({ task_id: "st_leak", execution_mode: "process", pid, updated_at: updatedAt })

test("#given a live process #when reading its start time #then it falls between just before the spawn and now", async () => {
  const before = Date.now()
  await withLiveProcess(async (pid) => {
    const startedAtMs = await readProcessStartMs(pid)

    expect(startedAtMs).not.toBeNull()
    // Readers round down to whole seconds at worst (Linux btime, darwin), never up.
    expect(startedAtMs).toBeGreaterThanOrEqual(before - 2_000)
    expect(startedAtMs).toBeLessThanOrEqual(Date.now())
  })
})

test("#given a recorded pid now held by a process created after the record was parked #when probing for leaks #then it is a reused pid, not a leak", async () => {
  // given: the #14529 shape - the child exited at its parent's teardown and Windows handed its pid to another process
  const parkedBeforeTheProcessExisted = new Date(Date.now() - 600_000).toISOString()
  await withLiveProcess(async (pid) => {
    // when
    const { survivors, reused } = await survivingRecordedChildren([rpcRecord(pid, parkedBeforeTheProcessExisted)])

    // then
    expect(survivors).toEqual([])
    expect(reused.map((fact) => fact.pid)).toEqual([pid])
    expect(pidAlive(pid)).toBe(true)
  })
})

test("#given a recorded child still running after its record was parked #when probing for leaks #then it is a leak", async () => {
  await withLiveProcess(async (pid) => {
    // given
    const parkedWhileTheChildRan = new Date().toISOString()

    // when
    const { survivors, reused } = await survivingRecordedChildren([rpcRecord(pid, parkedWhileTheChildRan)])

    // then
    expect(survivors.map((fact) => fact.pid)).toEqual([pid])
    expect(reused).toEqual([])
  })
})

test("#given a live recorded pid whose start time cannot be read #when probing for leaks #then it counts as a leak", async () => {
  const { survivors, reused } = await survivingRecordedChildren([rpcRecord(4242, "2026-11-21T03:30:00.000Z")], {
    isAlive: () => true,
    startMs: async () => null,
  })

  expect(survivors.map((fact) => fact.pid)).toEqual([4242])
  expect(reused).toEqual([])
})

test("#given recorded pids that are gone or not rpc children #when probing for leaks #then nothing is reported", async () => {
  const records = [
    rpcRecord(4242, "2026-11-21T03:30:00.000Z"),
    { task_id: "st_inproc", execution_mode: "in-process", pid: 4343, updated_at: "2026-11-21T03:30:00.000Z" },
  ]

  const result = await survivingRecordedChildren(records, {
    isAlive: (pid) => pid === 4343,
    startMs: async () => 0,
  })

  expect(result).toEqual({ survivors: [], reused: [] })
})
