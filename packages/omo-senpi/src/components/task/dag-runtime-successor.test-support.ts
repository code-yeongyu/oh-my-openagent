// The successor runtime of a session whose runs a dying (or dead) host left `running` under its
// lease, with every child admission of a gated run held until the test releases it.
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
  gateStartOwned,
  ManualTimers,
  recoveryEngine,
  ScriptedRunner,
} from "./dag-runtime-recovery.test-support"

const DEAD_HOST_PID = 2_147_483_646
const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

type NodeStates = Readonly<Record<string, Partial<DagRunRecordV1["nodes"][number]>>>

/**
 * A session whose runs a dying host left `running` under its lease (`deadHolder` runs name a host
 * that is already gone), and its successor runtime.
 */
export async function successorSession(
  cleanupRoots: string[],
  name: string,
  runs: Readonly<Record<string, NodeStates>>,
  holder: { alive: boolean },
  deadHolder: ReadonlySet<string> = new Set(),
) {
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
    const leaseHolderPid = deadHolder.has(key) ? DEAD_HOST_PID : FOREIGN_HOST_PID
    store.writeCheckpoint(runId, { ...record, nodes, status: "running", leaseHolderPid })
    runIds.set(key, runId)
  }

  const gated = new Set<string>()
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const admission = gateStartOwned(engine, (owner) => gated.has(owner.runId))
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
  const lease = (key: string): number | undefined =>
    store.readCheckpoint<{ readonly leaseHolderPid?: number }>(runId(key))?.leaseHolderPid
  const status = (key: string): string =>
    store.readCheckpoint<{ readonly status: string }>(runId(key))?.status ?? "missing"
  return {
    sessionId,
    store,
    engine,
    runtime,
    runner,
    timers,
    startOwned: admission.calls,
    runId,
    eventTypes,
    lease,
    status,
    gate: (key: string) => gated.add(runId(key)),
    entered: admission.entered,
    release: admission.release,
  }
}
