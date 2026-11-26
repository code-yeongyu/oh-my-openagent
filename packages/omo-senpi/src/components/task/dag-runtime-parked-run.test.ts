// A scheduler that finds active nodes whose children it does not hold parks the run as paused and
// keeps those nodes active (#15125). No scheduler holds their children then, so the run-level verbs
// must not act as if one did: Cancel ends the children for real, and a retry or amend that would
// build yet another bare scheduler is refused until recovery reattaches them.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, createDagScheduler, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { dagNode, recoveryEngine, ScriptedRunner, within } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

const definition = (sideNote = "") => ({
  key: "parked",
  name: "parked run",
  nodes: [dagNode("first"), dagNode("second", ["first"]), { ...dagNode("side"), prompt: `side${sideNote}` }],
})

/** A run whose `first` child is alive in this engine while the run is parked with no scheduler. */
async function parkedRun(name: string) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-parked-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-parked-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const runtime = createDagRuntime({ pi, engine, logger: quietLogger })
  await within(runtime.attach(), "attach")
  const started = await within(
    runtime.manager.start({ parentSessionId: sessionId, rootSessionId: sessionId, definition: definition() }),
    "manager.start",
  )
  const runId = started.snapshot.runId
  await within(runner.whenStarted(2), "first and side starting")
  const handleOf = (nodeId: string) =>
    runner.handles.find((handle) => engine.manager.get(handle.spec.taskId)?.name === nodeId)
  const firstTask = handleOf("first")?.spec.taskId
  if (firstTask === undefined) throw new Error("expected the first node's child")
  handleOf("side")?.settle("side done")
  await within(runtime.pauseForShutdown(), "pauseForShutdown")

  // A scheduler built over the run holds none of its children, so it parks the run.
  const checkpoint = store.readCheckpoint<DagRunRecordV1>(runId)
  if (checkpoint === null) throw new Error("expected a paused checkpoint")
  // A parked scheduler releases its lease when it settles, so the parked run names no holder.
  const { previousLeaseHolderPid: _previous, ...paused } = checkpoint
  const nodes = paused.nodes.map((entry) => (entry.id === "side" ? { ...entry, state: "failed" as const } : entry))
  store.writeCheckpoint(runId, { ...paused, nodes, status: "running" })
  const parked = await createDagScheduler({
    store,
    taskManager: engine.manager,
    initialRecord: { ...paused, nodes, status: "running" },
  }).run()
  expect(parked.status).toBe("paused")
  const eventCount = (): number => store.readEvents(runId, 0, { limit: 500 }).events.length
  return { runId, sessionId, runtime, runner, engine, store, firstTask, eventCount }
}

describe("DAG runtime verbs on a parked run", () => {
  test("#given a parked run whose node child is alive in this host #when the run is cancelled #then the child is really ended before the run reads cancelled", async () => {
    // given
    const { runId, sessionId, runtime, runner, engine, store, firstTask } = await parkedRun("cancel")

    // when
    await within(runtime.cancel(runId), "runtime.cancel")

    // then
    expect(runner.aborted).toContain(firstTask)
    expect(engine.manager.get(firstTask)?.status).toBe("cancelled")
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("cancelled")
    expect(runtime.manager.record(runId, sessionId).nodes.map((entry) => entry.state)).toEqual([
      "cancelled",
      "cancelled",
      "failed",
    ])
    runtime.dispose()
  })

  for (const verb of ["retry", "amend"] as const) {
    test(`#given a parked run whose node child is alive in this host #when ${verb} runs #then it is refused and no scheduler starts a node`, async () => {
      // given
      const { runId, runtime, runner, eventCount } = await parkedRun(verb)
      const before = eventCount()

      // when
      const attempt = verb === "retry" ? runtime.retry(runId, ["side"]) : runtime.amend(runId, definition(" amended"))
      const refusal = await within(
        attempt.then(
          () => undefined,
          (error: unknown) => error,
        ),
        verb,
      )

      // then
      expect(refusal).toEqual(expect.objectContaining({ code: "run_still_active" }))
      expect(eventCount()).toBe(before)
      expect(runner.handles).toHaveLength(2)
      runtime.dispose()
    })
  }
})
