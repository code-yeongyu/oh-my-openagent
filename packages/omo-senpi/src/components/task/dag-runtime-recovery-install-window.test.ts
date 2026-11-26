// Recovery claims a run, writes its own pid as the lease, and only then reconciles and installs the
// scheduler. Until that scheduler is registered nothing in this runtime holds the run, so whatever
// arrives in that window - a second recovery sweep, a shutdown - must wait for the installation.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagManager,
  type DagRunEvent,
  type DagRunId,
  type DagRunRecordV1,
} from "@oh-my-opencode/senpi-task/dag"

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

function deferred<T = undefined>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type NodeStates = Readonly<Record<string, Partial<DagRunRecordV1["nodes"][number]>>>

/** A session whose runs a dead (or dying) host left `running` under its lease, and its successor runtime. */
async function successorSession(name: string, runs: Readonly<Record<string, NodeStates>>, holder: { alive: boolean }) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-install-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-install-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  const manager = createDagManager({ store })
  const runIds = new Map<string, DagRunId>()
  for (const [key, states] of Object.entries(runs)) {
    const started = await manager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: { key, name: key, nodes: [dagNode("first"), dagNode("second", ["first"])] },
    })
    const runId = started.snapshot.runId
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) throw new Error("expected a started checkpoint")
    const nodes = record.nodes.map((entry) => ({ ...entry, ...states[String(entry.id)] }))
    store.writeCheckpoint(runId, { ...record, nodes, status: "running", leaseHolderPid: FOREIGN_HOST_PID })
    runIds.set(key, runId)
  }

  // The admission of each gated run's first child waits until the test lets it through.
  const gate = deferred()
  const entered = deferred()
  const gated = new Set<DagRunId>()
  const startOwned: string[] = []
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const original = engine.manager.startOwned.bind(engine.manager)
  Object.assign(engine.manager, {
    startOwned: async (...args: Parameters<typeof original>) => {
      startOwned.push(`${args[1].runId}:${String(args[1].nodeId)}`)
      if (gated.has(args[1].runId)) {
        entered.resolve(undefined)
        await gate.promise
      }
      return original(...args)
    },
  })
  const timers = new ManualTimers()
  const runtime = createDagRuntime({
    pi,
    engine,
    logger: quietLogger,
    leaseWatch: { isProcessAlive: (pid) => pid === FOREIGN_HOST_PID && holder.alive, timers, intervalMs: 250 },
  })
  const runId = (key: string): DagRunId => {
    const id = runIds.get(key)
    if (id === undefined) throw new Error(`no run ${key}`)
    return id
  }
  const eventTypes = (key: string): readonly DagRunEvent["type"][] =>
    store.readEvents(runId(key), 0, { limit: 500 }).events.map((event) => event.type)
  const status = (key: string): string =>
    store.readCheckpoint<{ readonly status: string }>(runId(key))?.status ?? "missing"
  return {
    sessionId,
    runtime,
    runner,
    timers,
    startOwned,
    runId,
    eventTypes,
    status,
    gate: (key: string) => gated.add(runId(key)),
    entered: entered.promise,
    release: () => gate.resolve(undefined),
  }
}

describe("DAG runtime while recovery is still installing a claimed run", () => {
  test("#given recovery waiting on a claimed run's admission #when the session shuts down #then the run ends paused and no scheduler starts after the pause", async () => {
    // given - the dead host left `first` scheduled, so the claim must launch its child first
    const session = await successorSession("shutdown", { killed: { first: { state: "scheduled" } } }, { alive: false })
    session.gate("killed")
    const attaching = session.runtime.attach()
    await within(session.entered, "recovery reaching the admission")

    // when
    const pausing = session.runtime.pauseForShutdown()
    session.release()
    await within(attaching, "attach")
    await within(pausing, "pauseForShutdown")

    // then
    const runEvents = session.eventTypes("killed").filter((type) => type.startsWith("dag.run."))
    expect(runEvents.at(-1)).toBe("dag.run.paused")
    expect(session.status("killed")).toBe("paused")
    session.runtime.dispose()
  })

  test("#given two leased runs whose holder exits #when both lease watches fire while one claim waits on admission #then that run is installed once", async () => {
    // given
    const holder = { alive: true }
    const session = await successorSession(
      "two-watches",
      { gated: { first: { state: "scheduled" } }, plain: { first: { state: "completed" } } },
      holder,
    )
    session.gate("gated")
    await within(session.runtime.attach(), "attach")
    expect(session.status("gated")).toBe("running")

    // when - both watches fire in one tick and each starts a whole-session sweep
    holder.alive = false
    session.timers.tick()
    await within(session.entered, "the gated claim reaching the admission")
    session.release()
    for (let started = 1; started <= 3; started += 1) {
      await within(session.runner.whenStarted(started), `child ${started} starting`)
      session.runner.handles[started - 1]?.settle(`done ${started}`)
    }
    const [gated, plain] = await Promise.all([
      within(session.runtime.wait(session.runId("gated"), session.sessionId), "the gated run settling"),
      within(session.runtime.wait(session.runId("plain"), session.sessionId), "the plain run settling"),
    ])

    // then - one installation: one resumed generation and one launch per node
    expect(gated.status).toBe("completed")
    expect(plain.status).toBe("completed")
    expect(session.eventTypes("gated").filter((type) => type === "dag.run.resumed")).toHaveLength(1)
    expect(session.startOwned.filter((entry) => entry.startsWith(session.runId("gated"))).sort()).toEqual([
      `${session.runId("gated")}:first`,
      `${session.runId("gated")}:second`,
    ])
    expect(session.runner.handles).toHaveLength(3)
    session.runtime.dispose()
  })
})
