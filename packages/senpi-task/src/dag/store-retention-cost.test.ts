import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore } from "./store"
import type { DagRunId } from "./types"

const cleanupRoots: string[] = []

afterEach(() => {
  mock.restore()
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retention-cost-"))
  cleanupRoots.push(directory)
  return directory
}

const EXPIRED_AT = "2026-01-01T00:00:00.000Z"
const NOW = Date.parse("2026-02-01T00:00:00.000Z")

describe("createDagFileStore retention cost", () => {
  test("#given many expired runs each owning a key #when retention runs #then the keys directory is scanned once, not once per run", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject(), task: { dag: { retention_days: 7 } } })
    const runIds = ["run-a", "run-b", "run-c", "run-d", "run-e"].map((id) => id as DagRunId)
    for (const runId of runIds) {
      store.writeCheckpoint(runId, {
        schemaVersion: 1,
        runId,
        runKey: `key-${runId}`,
        parentSessionId: "parent-session",
        status: "completed",
        completedAt: EXPIRED_AT,
        nodes: [],
      })
      store.writeKey({ schemaVersion: 1, parentSessionId: "parent-session", runKey: `key-${runId}`, runId })
    }
    const readdir = spyOn(fs, "readdirSync")

    // when
    const pruned = store.pruneExpired(NOW)

    // then
    expect(pruned.length).toBe(runIds.length)
    const keyScans = readdir.mock.calls.filter(([target]) => String(target) === store.paths.keys).length
    expect(keyScans).toBe(1)
    const lockScans = readdir.mock.calls.filter(([target]) => String(target) === store.paths.locks).length
    expect(lockScans).toBe(1)
  })

  test("#given expired runs sharing the directory with a live run's key #when retention runs #then only the expired runs' keys are removed", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject(), task: { dag: { retention_days: 7 } } })
    const expiredId = "run-expired" as DagRunId
    const liveId = "run-live" as DagRunId
    store.writeCheckpoint(expiredId, {
      schemaVersion: 1,
      runId: expiredId,
      runKey: `key-${expiredId}`,
      parentSessionId: "parent-session",
      status: "completed",
      completedAt: EXPIRED_AT,
      nodes: [],
    })
    store.writeCheckpoint(liveId, {
      schemaVersion: 1,
      runId: liveId,
      runKey: `key-${liveId}`,
      parentSessionId: "parent-session",
      status: "running",
      completedAt: EXPIRED_AT,
      nodes: [],
    })
    const expiredKey = store.writeKey({
      schemaVersion: 1, parentSessionId: "parent-session", runKey: `key-${expiredId}`, runId: expiredId,
    })
    const liveKey = store.writeKey({
      schemaVersion: 1, parentSessionId: "parent-session", runKey: `key-${liveId}`, runId: liveId,
    })

    // when
    store.pruneExpired(NOW)

    // then
    expect(fs.existsSync(expiredKey)).toBe(false)
    expect(fs.existsSync(liveKey)).toBe(true)
  })
})
