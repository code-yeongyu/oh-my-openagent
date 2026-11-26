// A retry or an amend revives a settled run under a new scheduler. That re-entry writes the run back
// to `running` and admits children, so it must own the run's lease before its first write: otherwise
// another process's recovery can claim the revived record while this host already dispatches into it,
// and a re-entry under another live process's lease would start children nobody here owns (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import {
  dagNode,
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

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number }

const definition = (prompt = "one") => ({
  key: "reentry-lease",
  name: "reentry lease",
  nodes: [{ ...dagNode("one"), prompt }],
})

/** A run this runtime started and then cancelled, so its node can be retried or amended. */
async function cancelledRun(name: string, holder: { alive: boolean } = { alive: true }) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-reentry-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-reentry-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const runtime = createDagRuntime({
    pi,
    engine,
    logger: quietLogger,
    leaseWatch: {
      isProcessAlive: (pid) => pid === FOREIGN_HOST_PID && holder.alive,
      timers: new ManualTimers(),
      intervalMs: 250,
    },
  })
  await within(runtime.attach(), "attach")
  const started = await within(
    runtime.manager.start({ parentSessionId: sessionId, rootSessionId: sessionId, definition: definition() }),
    "manager.start",
  )
  const runId = started.snapshot.runId
  await within(runner.whenStarted(1), "the first child starting")
  await within(runtime.cancel(runId), "runtime.cancel")
  expect(store.readCheckpoint<Leased>(runId)?.status).toBe("cancelled")

  // The lease each admission found on disk when it reached the task manager.
  const leaseAtStart: Array<number | undefined> = []
  const original = engine.manager.startOwned.bind(engine.manager)
  Object.assign(engine.manager, {
    startOwned: (...args: Parameters<typeof original>) => {
      leaseAtStart.push(store.readCheckpoint<Leased>(runId)?.leaseHolderPid)
      return original(...args)
    },
  })
  const eventCount = (): number => store.readEvents(runId, 0, { limit: 500 }).events.length
  // The run as a shutdown pause between nodes leaves it: paused, its node failed, the pausing host
  // recorded as the previous holder.
  const pausedBy = (previousLeaseHolderPid: number): void => {
    const record = store.readCheckpoint<Leased>(runId)
    if (record === null) throw new Error("expected a checkpoint")
    const { leaseHolderPid: _lease, ...unleased } = record
    const nodes = unleased.nodes.map((entry) => ({ ...entry, state: "failed" as const }))
    store.writeCheckpoint(runId, { ...unleased, nodes, status: "paused", previousLeaseHolderPid })
  }
  const bytes = (): string =>
    fs.readFileSync(store.paths.run(runId), "utf8") + fs.readFileSync(store.paths.event(runId), "utf8")
  return { runId, sessionId, store, runtime, runner, leaseAtStart, eventCount, pausedBy, bytes }
}

describe("DAG runtime re-entry takes the run's lease first", () => {
  test("#given a settled run whose lease a live foreign process holds #when it is retried #then the retry is refused before anything is journaled or started", async () => {
    // given
    const { runId, store, runtime, runner, leaseAtStart, eventCount } = await cancelledRun("foreign")
    const record = store.readCheckpoint<Leased>(runId)
    if (record === null) throw new Error("expected a checkpoint")
    store.writeCheckpoint(runId, { ...record, leaseHolderPid: FOREIGN_HOST_PID })
    const before = eventCount()

    // when
    const refusal = await within(
      runtime.retry(runId).then(
        () => undefined,
        (error: unknown) => error,
      ),
      "runtime.retry",
    )

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(eventCount()).toBe(before)
    expect(leaseAtStart).toEqual([])
    expect(runner.handles).toHaveLength(1)
    runtime.dispose()
  })

  for (const verb of ["retry", "amend"] as const) {
    test(`#given a settled run #when ${verb} re-enters it #then the first admission already finds this host's lease on disk`, async () => {
      // given
      const { runId, runtime, runner, leaseAtStart } = await cancelledRun(verb)

      // when
      await within(verb === "retry" ? runtime.retry(runId) : runtime.amend(runId, definition("one again")), verb)
      await within(runner.whenStarted(2), "the re-entered child starting")

      // then
      expect(leaseAtStart[0]).toBe(process.pid)
      runtime.dispose()
    })
  }

  for (const verb of ["retry", "amend"] as const) {
    const reenter = (
      runtime: Awaited<ReturnType<typeof cancelledRun>>["runtime"],
      runId: Parameters<typeof runtime.retry>[0],
    ) => (verb === "retry" ? runtime.retry(runId) : runtime.amend(runId, definition("one again")))

    test(`#given a run paused for shutdown by a foreign host that is still draining #when ${verb} re-enters it #then it is refused with nothing written, and goes through once that host is gone`, async () => {
      // given
      const holder = { alive: true }
      const { runId, runtime, runner, pausedBy, bytes } = await cancelledRun(`draining-${verb}`, holder)
      pausedBy(FOREIGN_HOST_PID)
      const before = bytes()

      // when
      const refusal = await within(
        reenter(runtime, runId).then(
          () => undefined,
          (error: unknown) => error,
        ),
        verb,
      )

      // then
      expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
      expect(bytes()).toBe(before)
      expect(runner.handles).toHaveLength(1)

      // and when that host has exited
      holder.alive = false
      await within(reenter(runtime, runId), `${verb} after the holder exited`)
      await within(runner.whenStarted(2), "the re-entered child starting")
      runtime.dispose()
    })

    test(`#given a run this host paused for shutdown #when ${verb} re-enters it #then it goes through`, async () => {
      // given
      const { runId, runtime, runner, pausedBy } = await cancelledRun(`own-${verb}`)
      pausedBy(process.pid)

      // when
      await within(reenter(runtime, runId), verb)

      // then
      await within(runner.whenStarted(2), "the re-entered child starting")
      runtime.dispose()
    })
  }

  test("#given a run paused for shutdown by a foreign host that is still draining #when a node is sent a message #then the send is refused under the same holder rule and nothing is written", async () => {
    // given
    const { runId, runtime, runner, pausedBy, bytes } = await cancelledRun("draining-send")
    pausedBy(FOREIGN_HOST_PID)
    const before = bytes()

    // when
    const refusal = await within(
      runtime.send(runId, "one", "continue").then(
        () => undefined,
        (error: unknown) => error,
      ),
      "runtime.send",
    )

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(bytes()).toBe(before)
    expect(runner.handles).toHaveLength(1)
    runtime.dispose()
  })
})
