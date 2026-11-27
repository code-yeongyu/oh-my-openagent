// A run started fresh used to record no holder until a child attached, so between `started` and the
// first attachment nothing durable said a live process was scheduling it, and a recovery in another
// process read it as abandoned (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, createDagRecovery, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import {
  dagNode,
  FOREIGN_HOST_PID,
  gateStartOwned,
  recoveryEngine,
  ScriptedRunner,
  within,
} from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }

describe("DAG runtime lease of a run it starts", () => {
  test("#given a fresh run whose first child has not attached yet #when another process runs recovery #then this host's durable lease keeps the run, and it is released once the run settles", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-first-lease-"))
    cleanupRoots.push(cwd)
    const sessionId = "session-first-lease"
    const store = createDagFileStore({ project_dir: cwd })
    const pi = new FakeExtensionAPI()
    const runner = new ScriptedRunner()
    const engine = recoveryEngine(cwd, sessionId, pi, runner)
    const admission = gateStartOwned(engine, () => true)
    const runtime = createDagRuntime({ pi, engine, logger: quietLogger })
    await within(runtime.attach(), "attach")
    const started = await within(
      runtime.manager.start({
        parentSessionId: sessionId,
        rootSessionId: sessionId,
        definition: { key: "first-lease", name: "first lease", nodes: [dagNode("only")] },
      }),
      "manager.start",
    )
    const runId = started.snapshot.runId
    await within(admission.entered, "the first admission")
    expect(store.readCheckpoint<Leased>(runId)?.leaseHolderPid).toBe(process.pid)

    // when - a recovery in another process, for which this process is alive
    const successor = createDagRecovery({
      store,
      taskManager: engine.manager,
      hostPid: FOREIGN_HOST_PID,
      isProcessAlive: (pid) => pid === process.pid,
      isRunHeldInProcess: () => false,
    })
    const outcomes = await within(successor.resumePausedRuns(sessionId), "the successor's recovery")

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: process.pid }])

    // and then - the lease goes with the scheduler once the run settles
    admission.release()
    await within(runner.whenStarted(1), "the child starting")
    runner.handles[0]?.settle("done")
    const result = await within(runtime.wait(runId, sessionId), "runtime.wait")
    expect(result.status).toBe("completed")
    const settled = store.readCheckpoint<Leased>(runId)
    expect(settled?.leaseHolderPid).toBeUndefined()
    expect(settled?.previousLeaseHolderPid).toBeUndefined()
    runtime.dispose()
  })
})
