// A host killed mid-run never writes the shutdown pause, so its run stays `running` with a child
// attached. The session that reopened used to build a fresh scheduler over that run. It held none
// of the run's children, failed, and left the run shown as running for good.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunEvent, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import {
  dagNode as node,
  FOREIGN_HOST_PID,
  ManualTimers,
  recoveryEngine,
  ScriptedRunner,
  within,
} from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

/**
 * The run a killed host leaves behind, and the runtime of the session that reopens it. The first
 * runtime starts `first -> second` and gets `first`'s child running; its scheduler is then retired
 * and the checkpoint put back the way a kill leaves it: `running`, the pause never written, the
 * lease naming the dead host. That child died with its host, so nothing in the successor backs it.
 */
async function killedHostFixture(
  name: string,
  holder: { alive: boolean },
  leftAt: "mid-node" | "between-nodes" = "mid-node",
) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-killed-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-killed-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  const engineFor = (pi: FakeExtensionAPI, runner: ScriptedRunner) => recoveryEngine(cwd, sessionId, pi, runner)
  const startParams = {
    parentSessionId: sessionId,
    rootSessionId: sessionId,
    definition: { key: `killed-${name}`, name: "killed host", nodes: [node("first"), node("second", ["first"])] },
  }

  const firstPi = new FakeExtensionAPI()
  const firstRunner = new ScriptedRunner()
  const firstRuntime = createDagRuntime({ pi: firstPi, engine: engineFor(firstPi, firstRunner), logger: quietLogger })
  await within(firstRuntime.attach(), "first attach")
  const started = await within(firstRuntime.manager.start(startParams), "manager.start")
  const runId = started.snapshot.runId
  await within(firstRunner.whenStarted(1), "the first child starting")
  await firstRuntime.pauseForShutdown()
  firstRuntime.dispose()
  const paused = store.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
  if (paused === null) throw new Error("expected the first runtime to leave a checkpoint")
  const { previousLeaseHolderPid: _previous, ...record } = paused
  const nodes =
    leftAt === "mid-node"
      ? record.nodes
      : record.nodes.map((entry) => (entry.id === "first" ? { ...entry, state: "completed" as const } : entry))
  store.writeCheckpoint(runId, { ...record, nodes, status: "running", leaseHolderPid: FOREIGN_HOST_PID })

  const timers = new ManualTimers()
  const errors: string[] = []
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const runtime: DagRuntime = createDagRuntime({
    pi,
    engine: engineFor(pi, runner),
    logger: { ...quietLogger, error: (message: string) => errors.push(message) },
    leaseWatch: { isProcessAlive: (pid) => pid === FOREIGN_HOST_PID && holder.alive, timers, intervalMs: 250 },
  })
  const eventTypes = (): readonly DagRunEvent["type"][] =>
    store.readEvents(runId, 0, { limit: 200 }).events.map((event) => event.type)
  const status = (): string => store.readCheckpoint<{ readonly status: string }>(runId)?.status ?? "missing"
  const startAgain = () => within(runtime.manager.start(startParams), "same-key manager.start")
  return { runId, sessionId, timers, errors, runner, runtime, eventTypes, status, startAgain }
}

describe("DAG runtime recovery of a run its host left running", () => {
  test("#given a run left running by a killed host #when the session reopens #then the run is claimed and settles instead of staying running", async () => {
    // given
    const { runId, sessionId, errors, runtime, eventTypes } = await killedHostFixture("claimed", { alive: false })

    // when
    await within(runtime.attach(), "attach")

    // then - the claim is journaled by the time the session start returns
    expect(eventTypes()).toContain("dag.run.resumed")

    // and then - the child that died with its host fails its node, and the run ends where the
    // parent can see it and retry
    const result = await within(runtime.wait(runId, sessionId), "runtime.wait")
    expect(result.status).toBe("failed")
    expect(result.nodes.first).toEqual(
      expect.objectContaining({ state: "failed", error: expect.objectContaining({ code: "resume_task_orphaned" }) }),
    )
    expect(result.nodes.second).toEqual(expect.objectContaining({ state: "skipped" }))
    expect(errors).toEqual([])
    runtime.dispose()
  })

  test("#given a run left running whose host is still alive #when the session reopens #then the run is left to that host until it exits", async () => {
    // given
    const holder = { alive: true }
    const fixture = await killedHostFixture("live-holder", holder)
    const { runId, sessionId, timers, errors, runtime, eventTypes, status } = fixture
    const before = eventTypes()

    // when
    await within(runtime.attach(), "attach")

    // then - no scheduler of this host touches the run; one poll waits for the holder
    expect(status()).toBe("running")
    expect(eventTypes()).toEqual(before)
    expect(errors).toEqual([])
    expect(timers.pending()).toBe(1)

    // when the holder exits before the next poll
    holder.alive = false
    timers.tick()
    const result = await within(runtime.wait(runId, sessionId), "runtime.wait")

    // then
    expect(eventTypes()).toContain("dag.run.resumed")
    expect(result.status).toBe("failed")
    runtime.dispose()
  })

  test("#given a run a live host holds between two nodes #when the session reopens #then this host starts none of its nodes", async () => {
    // given - nothing is attached, so only the lease says the run is taken
    const fixture = await killedHostFixture("live-holder-between-nodes", { alive: true }, "between-nodes")
    const { timers, errors, runner, runtime, eventTypes, status } = fixture
    const before = eventTypes()

    // when
    await within(runtime.attach(), "attach")

    // then
    expect(status()).toBe("running")
    expect(eventTypes()).toEqual(before)
    expect(runner.handles).toHaveLength(0)
    expect(errors).toEqual([])
    expect(timers.pending()).toBe(1)
    runtime.dispose()
  })

  test("#given a run a live host holds between two nodes #when the successor starts the same key #then the reused run is left to its holder", async () => {
    // given
    const fixture = await killedHostFixture("live-holder-same-key", { alive: true }, "between-nodes")
    const { runId, errors, runner, runtime, eventTypes, status, startAgain } = fixture
    await within(runtime.attach(), "attach")
    const before = eventTypes()

    // when
    const result = await startAgain()

    // then
    expect(result.reused).toBe(true)
    expect(result.snapshot.runId).toBe(runId)
    expect(status()).toBe("running")
    expect(eventTypes()).toEqual(before)
    expect(runner.handles).toHaveLength(0)
    expect(errors).toEqual([])
    runtime.dispose()
  })

  test("#given a run a live host holds #when the successor shuts down #then it does not pause the run it never held", async () => {
    // given
    const fixture = await killedHostFixture("live-holder-shutdown", { alive: true }, "between-nodes")
    const { runtime, eventTypes, status } = fixture
    await within(runtime.attach(), "attach")
    const before = eventTypes()

    // when
    await within(runtime.pauseForShutdown(), "pauseForShutdown")

    // then
    expect(status()).toBe("running")
    expect(eventTypes()).toEqual(before)
    runtime.dispose()
  })
})
