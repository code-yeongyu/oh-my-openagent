import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createDagFileStore, type DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"

const cleanupRoots: string[] = []
const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-retention-"))
  cleanupRoots.push(directory)
  return directory
}

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

function fakePi() {
  return Object.assign(new FakeExtensionAPI(), {
    rpc: { emit: () => undefined, handle: () => undefined },
  })
}

/**
 * Seeds one run's durable artifacts the way production writes them: a checkpoint, an event log and
 * a node result. Retention is judged on the checkpoint, so `status` and the terminal timestamp are
 * what each case varies.
 */
function seedRun(
  cwd: string,
  runId: DagRunId,
  input: {
    readonly status: "completed" | "failed" | "cancelled" | "paused" | "running"
    readonly terminalAt: string
    readonly leaseHolderPid?: number
  },
): { readonly checkpoint: string; readonly events: string; readonly results: string } {
  const store = createDagFileStore({ project_dir: cwd })
  store.writeCheckpoint(runId, {
    schemaVersion: 1,
    runId,
    runKey: `key-${runId}`,
    parentSessionId: "parent-session",
    status: input.status,
    // `pruneExpired` reads `completedAt ?? updatedAt`, so both spellings carry the same instant.
    completedAt: input.terminalAt,
    updatedAt: input.terminalAt,
    nodes: [],
    ...(input.leaseHolderPid === undefined ? {} : { leaseHolderPid: input.leaseHolderPid }),
  })
  store.appendEvent({
    schemaVersion: 1,
    runId,
    seq: 1,
    at: input.terminalAt,
    lane: "boundary",
    type: "dag.run.started",
    generation: 1,
  } as never)
  store.writeResult(runId, "node-a", "durable result")
  return {
    checkpoint: store.paths.run(runId),
    events: store.paths.event(runId),
    results: join(store.paths.results, runId),
  }
}

function buildRuntime(cwd: string, retentionSweep?: { readonly schedule?: (sweep: () => void) => void }) {
  const pi = fakePi()
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
  })
  return createDagRuntime({
    pi,
    engine,
    logger: silentLogger(),
    ...(retentionSweep === undefined ? {} : { retentionSweep }),
  })
}

/** Awaits a durable state change (the artifact disappearing) under a bounded deadline. */
async function waitUntilGone(path: string, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (fs.existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`still present after ${budgetMs}ms: ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("DAG retention sweep runs from the production runtime", () => {
  test("#given a terminal run older than retention_days #when the task runtime is constructed #then its checkpoint, event log and results are reclaimed", async () => {
    // given
    const cwd = tempProject()
    const expired = seedRun(cwd, "run-expired" as DagRunId, {
      status: "completed",
      terminalAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    })
    expect(fs.existsSync(expired.checkpoint)).toBe(true)

    // when - the sweep is driven through the production constructor, never by calling the store
    const runtime = buildRuntime(cwd, { schedule: (sweep) => sweep() })

    // then
    try {
      expect(fs.existsSync(expired.checkpoint)).toBe(false)
      expect(fs.existsSync(expired.events)).toBe(false)
      expect(fs.existsSync(expired.results)).toBe(false)
    } finally {
      runtime.dispose()
    }
  })

  test("#given a terminal run inside retention_days #when the task runtime is constructed #then the run is kept", () => {
    // given
    const cwd = tempProject()
    const fresh = seedRun(cwd, "run-fresh" as DagRunId, {
      status: "completed",
      terminalAt: new Date(Date.now() - 1 * DAY_MS).toISOString(),
    })

    // when
    const runtime = buildRuntime(cwd, { schedule: (sweep) => sweep() })

    // then
    try {
      expect(fs.existsSync(fresh.checkpoint)).toBe(true)
      expect(fs.existsSync(fresh.events)).toBe(true)
      expect(fs.existsSync(fresh.results)).toBe(true)
    } finally {
      runtime.dispose()
    }
  })

  test("#given a paused run older than retention_days whose lease holder is alive #when the task runtime is constructed #then the run is kept", () => {
    // given - a live lease belongs to a paused run, and `paused` is not a terminal status
    const cwd = tempProject()
    const leased = seedRun(cwd, "run-leased" as DagRunId, {
      status: "paused",
      terminalAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      leaseHolderPid: process.pid,
    })

    // when
    const runtime = buildRuntime(cwd, { schedule: (sweep) => sweep() })

    // then
    try {
      expect(fs.existsSync(leased.checkpoint)).toBe(true)
      expect(fs.existsSync(leased.events)).toBe(true)
      expect(fs.existsSync(leased.results)).toBe(true)
    } finally {
      runtime.dispose()
    }
  })

  test("#given an expired run #when the task runtime is constructed with the shipped scheduler #then construction returns before the sweep touches the disk and the sweep still completes", async () => {
    // given
    const cwd = tempProject()
    const expired = seedRun(cwd, "run-deferred" as DagRunId, {
      status: "completed",
      terminalAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    })

    // when - no injected scheduler, so this exercises the default production path
    const runtime = buildRuntime(cwd)

    // then
    try {
      expect(fs.existsSync(expired.checkpoint)).toBe(true)
      await waitUntilGone(expired.checkpoint)
      expect(fs.existsSync(expired.events)).toBe(false)
    } finally {
      runtime.dispose()
    }
  })
})
