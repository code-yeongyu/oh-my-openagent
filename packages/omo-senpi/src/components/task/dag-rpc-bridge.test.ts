import { describe, expect, it } from "bun:test"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  createDagRpcBridge,
  DAG_ACTIVITY_COALESCE_MS,
  DAG_DEFAULT_HEARTBEAT_MS,
  DAG_MAX_RUN_SNAPSHOTS,
  DAG_SNAPSHOT_DEBOUNCE_MS,
  type DagBridgeActivityEvent,
  type DagBridgeRun,
  type DagBridgeRunEvent,
  type DagBridgeRunSnapshot,
  type DagRpcBridgeDeps,
} from "./dag-rpc-bridge"

type EmittedEvent = { readonly name: string; readonly data: unknown }

type FakeTimer = { readonly id: number; readonly callback: () => void; readonly ms: number; dueAt: number }

// Deterministic timer seam: nothing fires until the test advances the clock, so no test ever waits
// on wall-clock time.
function fakeTimers() {
  const timers = new Map<number, FakeTimer>()
  let nextId = 1
  let clock = 0
  return {
    seam: {
      set(callback: () => void, ms: number) {
        const id = nextId
        nextId += 1
        timers.set(id, { id, callback, ms, dueAt: clock + ms })
        return id
      },
      clear(handle: number) {
        timers.delete(handle)
      },
    },
    now: () => clock,
    pending: () => timers.size,
    advance(ms: number) {
      const target = clock + ms
      for (;;) {
        const due = [...timers.values()].filter((timer) => timer.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt)[0]
        if (due === undefined) break
        clock = due.dueAt
        timers.delete(due.id)
        due.callback()
      }
      clock = target
    },
  }
}

function fakePi() {
  const emitted: EmittedEvent[] = []
  const pi = {
    on() {},
    rpc: { emit: (name: string, data: unknown) => void emitted.push({ name, data }) },
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    sendMessage() {},
    sendUserMessage() {},
  } as unknown as SenpiExtensionAPI
  return { pi, emitted }
}

// A journal stand-in: subscribers receive events only through publish(), mirroring the real journal
// which fans out strictly after the WAL append plus checkpoint replace.
function fakeRun(runId: string, status: DagBridgeRun["status"]) {
  const listeners = new Set<(event: DagBridgeRunEvent) => void>()
  let current = status
  const run: DagBridgeRun = {
    runId,
    get status() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
  return {
    run,
    setStatus(next: DagBridgeRun["status"]) {
      current = next
    },
    publish(event: DagBridgeRunEvent) {
      for (const listener of listeners) listener(event)
    },
  }
}

function runEvent(runId: string, seq: number, type: string): DagBridgeRunEvent {
  return { schemaVersion: 1, runId, seq, at: new Date(seq * 1000).toISOString(), lane: "boundary", type }
}

function activityEvent(runId: string, nodeId: string, activity: string): DagBridgeActivityEvent {
  return { schemaVersion: 1, runId, nodeId, taskId: `st_${nodeId}`, at: "2026-08-14T00:00:00.000Z", activity, turns: 1 }
}

function wire(
  runs: readonly DagBridgeRun[],
  overrides: Partial<DagRpcBridgeDeps> = {},
) {
  const timers = fakeTimers()
  const { pi, emitted } = fakePi()
  const owned = [...runs]
  const bridge = createDagRpcBridge(pi, {
    liveRuns: () => owned,
    timers: timers.seam,
    now: timers.now,
    ...overrides,
  })
  return { bridge, emitted, timers, addRun: (run: DagBridgeRun) => void owned.push(run) }
}

// A snapshot as the engine hands it over: camelCase in, snake_case out on the wire.
function runSnapshot(runId: string, overrides: Partial<DagBridgeRunSnapshot> = {}): DagBridgeRunSnapshot {
  return {
    runId,
    runKey: `key_${runId}`,
    name: `run ${runId}`,
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:01.000Z",
    counts: {
      total: 2,
      pending: 0,
      blocked: 0,
      scheduled: 0,
      running: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    },
    nodes: [
      { id: "plan", prompt: "plan it", dependsOn: [], state: "completed", attempt: 1, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_plan" },
      { id: "build", label: "build", prompt: "build it", dependsOn: ["plan"], state: "running", attempt: 1, createdAt: "2026-08-14T00:00:00.000Z" },
    ],
    edges: [{ from: "plan", to: "build" }],
    waves: [
      { index: 0, nodeIds: ["plan"] },
      { index: 1, nodeIds: ["build"] },
    ],
    ...overrides,
  }
}

function wireSnapshots(initial: readonly DagBridgeRunSnapshot[], parentSessionId: string | null = "ses_parent") {
  const timers = fakeTimers()
  const { pi, emitted } = fakePi()
  let current = [...initial]
  const bridge = createDagRpcBridge(pi, {
    liveRuns: () => [],
    runSnapshots: () => current,
    parentSessionId: () => parentSessionId ?? undefined,
    timers: timers.seam,
    now: timers.now,
  })
  return {
    bridge,
    emitted,
    timers,
    setSnapshots: (next: readonly DagBridgeRunSnapshot[]) => void (current = [...next]),
  }
}

const emittedNames = (emitted: readonly EmittedEvent[], name: string) =>
  emitted.filter((entry) => entry.name === name)

describe("dag rpc bridge", () => {
  describe("#given a journal that fans out post-durability", () => {
    it("#when events arrive #then every event is emitted exactly once on omo.dag.event in seq order", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted } = wire([source.run])
      bridge.attach()

      // when
      source.publish(runEvent("dag_1", 1, "dag.run.created"))
      source.publish(runEvent("dag_1", 2, "dag.wave.started"))
      source.publish(runEvent("dag_1", 3, "dag.node.transitioned"))

      // then
      const events = emittedNames(emitted, "omo.dag.event")
      expect(events.map((entry) => (entry.data as DagBridgeRunEvent).seq)).toEqual([1, 2, 3])
      expect(events.map((entry) => (entry.data as DagBridgeRunEvent).type)).toEqual([
        "dag.run.created",
        "dag.wave.started",
        "dag.node.transitioned",
      ])
    })

    it("#when a run starts mid-session and sync runs #then its events reach the ledger too", () => {
      // given
      const first = fakeRun("dag_1", "running")
      const { bridge, emitted, addRun } = wire([first.run])
      bridge.attach()
      const late = fakeRun("dag_2", "running")
      addRun(late.run)

      // when
      bridge.sync()
      late.publish(runEvent("dag_2", 1, "dag.run.created"))

      // then
      const events = emittedNames(emitted, "omo.dag.event").map((entry) => entry.data as DagBridgeRunEvent)
      expect(events.map((event) => event.runId)).toEqual(["dag_2"])
    })

    it("#when the same seq is redelivered #then it is emitted once", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted } = wire([source.run])
      bridge.attach()

      // when
      source.publish(runEvent("dag_1", 1, "dag.run.created"))
      source.publish(runEvent("dag_1", 1, "dag.run.created"))

      // then
      expect(emittedNames(emitted, "omo.dag.event")).toHaveLength(1)
    })
  })

  describe("#given a session that owns a live run", () => {
    it("#when the heartbeat interval elapses #then omo.dag.heartbeat carries every live run head seq", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()
      source.publish(runEvent("dag_1", 4, "dag.wave.started"))

      // when
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS)

      // then
      const beats = emittedNames(emitted, "omo.dag.heartbeat")
      expect(beats).toHaveLength(1)
      expect(beats[0]?.data).toEqual({
        schemaVersion: 1,
        at: new Date(DAG_DEFAULT_HEARTBEAT_MS).toISOString(),
        runs: [{ runId: "dag_1", headSeq: 4 }],
      })
    })

    it("#when the run reaches a terminal status #then the heartbeat stops and no timer is left pending", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS)
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(1)

      // when
      source.setStatus("completed")
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS * 3)

      // then
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(1)
      expect(timers.pending()).toBe(0)
    })

    it("#when only terminal runs exist at attach #then no heartbeat is ever emitted", () => {
      // given
      const source = fakeRun("dag_1", "failed")
      const { bridge, emitted, timers } = wire([source.run])

      // when
      bridge.attach()
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS * 2)

      // then
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(0)
      expect(timers.pending()).toBe(0)
    })

    it("#when the session shuts down mid-run #then the heartbeat timer is cleared", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()
      expect(timers.pending()).toBeGreaterThan(0)

      // when
      bridge.dispose()
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS * 2)

      // then
      expect(timers.pending()).toBe(0)
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(0)
    })

    it("#when a session switch detaches the bridge #then no further run events are emitted", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()
      source.publish(runEvent("dag_1", 1, "dag.run.created"))

      // when
      bridge.detach()
      source.publish(runEvent("dag_1", 2, "dag.wave.started"))
      timers.advance(DAG_DEFAULT_HEARTBEAT_MS * 2)

      // then
      expect(emittedNames(emitted, "omo.dag.event")).toHaveLength(1)
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(0)
      expect(timers.pending()).toBe(0)
    })
  })

  describe("#given unsequenced activity telemetry", () => {
    it("#when a node bursts activity #then it coalesces to the latest payload on omo.dag.activity only", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()

      // when
      bridge.publishActivity(activityEvent("dag_1", "node_a", "reading"))
      bridge.publishActivity(activityEvent("dag_1", "node_a", "editing"))
      bridge.publishActivity(activityEvent("dag_1", "node_a", "running tests"))
      timers.advance(DAG_ACTIVITY_COALESCE_MS)

      // then
      const activity = emittedNames(emitted, "omo.dag.activity")
      expect(activity).toHaveLength(1)
      expect((activity[0]?.data as DagBridgeActivityEvent).activity).toBe("running tests")
      expect(emittedNames(emitted, "omo.dag.event")).toHaveLength(0)
    })

    it("#when two nodes are active #then coalescing is per node", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()

      // when
      bridge.publishActivity(activityEvent("dag_1", "node_a", "a1"))
      bridge.publishActivity(activityEvent("dag_1", "node_b", "b1"))
      bridge.publishActivity(activityEvent("dag_1", "node_a", "a2"))
      timers.advance(DAG_ACTIVITY_COALESCE_MS)

      // then
      const activity = emittedNames(emitted, "omo.dag.activity").map(
        (entry) => (entry.data as DagBridgeActivityEvent),
      )
      expect(activity.map((event) => [event.nodeId, event.activity])).toEqual([
        ["node_a", "a2"],
        ["node_b", "b1"],
      ])
    })

    it("#when activity is published after detach #then nothing is emitted and no timer survives", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run])
      bridge.attach()
      bridge.publishActivity(activityEvent("dag_1", "node_a", "reading"))

      // when
      bridge.detach()
      bridge.publishActivity(activityEvent("dag_1", "node_a", "editing"))
      timers.advance(DAG_ACTIVITY_COALESCE_MS * 4)

      // then
      expect(emittedNames(emitted, "omo.dag.activity")).toHaveLength(0)
      expect(timers.pending()).toBe(0)
    })
  })

  describe("#given the omo.dag.updated snapshot channel", () => {
    it("#when the store mutates twice with identical state #then only one snapshot is emitted", () => {
      // given
      const { bridge, emitted, timers } = wireSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(1)

      // when
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(1)
    })

    it("#when a real mutation lands #then a fresh snapshot reflecting it is emitted", () => {
      // given
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // when
      setSnapshots([
        runSnapshot("dag_1", {
          status: "completed",
          nodes: [
            { id: "plan", prompt: "plan it", dependsOn: [], state: "completed", attempt: 1, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_plan" },
            { id: "build", label: "build", prompt: "build it", dependsOn: ["plan"], state: "completed", attempt: 1, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_build" },
          ],
        }),
      ])
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const updates = emittedNames(emitted, "omo.dag.updated")
      expect(updates).toHaveLength(2)
      const latest = updates[1]?.data as { runs: { status: string; nodes: { id: string; state: string; task_id?: string }[] }[] }
      expect(latest.runs[0]?.status).toBe("completed")
      expect(latest.runs[0]?.nodes.map((node) => [node.id, node.state])).toEqual([
        ["plan", "completed"],
        ["build", "completed"],
      ])
      expect(latest.runs[0]?.nodes[1]?.task_id).toBe("st_build")
    })

    it("#when the payload is inspected #then it is snake_case and carries parent_session_id", () => {
      // given
      const { bridge, emitted, timers } = wireSnapshots([runSnapshot("dag_1")])

      // when
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const payload = emittedNames(emitted, "omo.dag.updated")[0]?.data
      expect(payload).toEqual({
        parent_session_id: "ses_parent",
        runs: [
          {
            run_id: "dag_1",
            run_key: "key_dag_1",
            name: "run dag_1",
            status: "running",
            created_at: "2026-08-14T00:00:00.000Z",
            updated_at: "2026-08-14T00:00:01.000Z",
            counts: {
              total: 2,
              pending: 0,
              blocked: 0,
              scheduled: 0,
              running: 1,
              completed: 1,
              failed: 0,
              cancelled: 0,
              skipped: 0,
            },
            nodes: [
              {
                id: "plan",
                prompt: "plan it",
                depends_on: [],
                state: "completed",
                attempt: 1,
                created_at: "2026-08-14T00:00:00.000Z",
                task_id: "st_plan",
              },
              {
                id: "build",
                label: "build",
                prompt: "build it",
                depends_on: ["plan"],
                state: "running",
                attempt: 1,
                created_at: "2026-08-14T00:00:00.000Z",
              },
            ],
            edges: [{ from: "plan", to: "build" }],
            waves: [
              { index: 0, node_ids: ["plan"] },
              { index: 1, node_ids: ["build"] },
            ],
          },
        ],
      })
    })

    it("#when more runs exist than the cap #then truncated_runs reports the overflow", () => {
      // given
      const overflow = 1
      const all = Array.from({ length: DAG_MAX_RUN_SNAPSHOTS + overflow }, (_, index) =>
        runSnapshot(`dag_${String(index).padStart(4, "0")}`),
      )
      const { bridge, emitted, timers } = wireSnapshots(all)

      // when
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const payload = emittedNames(emitted, "omo.dag.updated")[0]?.data as {
        runs: { run_id: string }[]
        truncated_runs?: number
      }
      expect(payload.runs).toHaveLength(DAG_MAX_RUN_SNAPSHOTS)
      expect(payload.truncated_runs).toBe(overflow)
      expect(payload.runs.at(-1)?.run_id).toBe(all[DAG_MAX_RUN_SNAPSHOTS - 1]?.runId)
      // The serialize+dedup cycle finishes inside the single debounce callback: no follow-up timer
      // is chained, so the cap boundary never spills work into a later window.
      expect(timers.pending()).toBe(0)
    })

    it("#when the run count is at the cap #then truncated_runs is absent", () => {
      // given
      const all = Array.from({ length: DAG_MAX_RUN_SNAPSHOTS }, (_, index) =>
        runSnapshot(`dag_${String(index).padStart(4, "0")}`),
      )
      const { bridge, emitted, timers } = wireSnapshots(all)

      // when
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const payload = emittedNames(emitted, "omo.dag.updated")[0]?.data as { truncated_runs?: number }
      expect(payload.truncated_runs).toBeUndefined()
    })

    it("#when mutations burst inside one debounce window #then they coalesce into a single emission", () => {
      // given
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // when
      setSnapshots([runSnapshot("dag_1", { status: "paused" })])
      bridge.notifyStoreMutation()
      setSnapshots([runSnapshot("dag_1", { status: "completed" })])
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const updates = emittedNames(emitted, "omo.dag.updated")
      expect(updates).toHaveLength(2)
      expect((updates[1]?.data as { runs: { status: string }[] }).runs[0]?.status).toBe("completed")
    })

    it("#when the session has no parent session id #then nothing is emitted on the snapshot channel", () => {
      // given
      const { bridge, emitted, timers } = wireSnapshots([runSnapshot("dag_1")], null)

      // when
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(0)
    })

    it("#when the bridge detaches #then a pending snapshot never lands and the fingerprint resets", () => {
      // given
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)
      setSnapshots([runSnapshot("dag_1", { status: "completed" })])
      bridge.notifyStoreMutation()

      // when
      bridge.detach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS * 4)

      // then
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(1)
      expect(timers.pending()).toBe(0)

      // and the next attach re-emits the current state despite the identical earlier fingerprint
      setSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(2)
    })

    it("#when the granular ledger emits #then the snapshot channel carries no per-event deltas", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const timers = fakeTimers()
      const { pi, emitted } = fakePi()
      const bridge = createDagRpcBridge(pi, {
        liveRuns: () => [source.run],
        runSnapshots: () => [runSnapshot("dag_1")],
        parentSessionId: () => "ses_parent",
        timers: timers.seam,
        now: timers.now,
      })
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // when
      source.publish(runEvent("dag_1", 1, "dag.run.created"))
      source.publish(runEvent("dag_1", 2, "dag.wave.started"))
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      expect(emittedNames(emitted, "omo.dag.event")).toHaveLength(2)
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(1)
    })
  })

  describe("#given the retry, steer, and amend event vocabulary", () => {
    it("#when the three new journaled types arrive #then the generic forward path emits each exactly once in seq order", () => {
      // given a run whose journal now fans out the control-verb events too
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted } = wire([source.run])
      bridge.attach()

      // when
      source.publish(runEvent("dag_1", 7, "dag.node.retried"))
      source.publish(runEvent("dag_1", 8, "dag.node.steered"))
      source.publish(runEvent("dag_1", 9, "dag.definition.amended"))
      // and the journal redelivers the retry after a reopen replay
      source.publish(runEvent("dag_1", 7, "dag.node.retried"))

      // then
      const events = emittedNames(emitted, "omo.dag.event").map((entry) => entry.data as DagBridgeRunEvent)
      expect(events.map((event) => [event.type, event.seq])).toEqual([
        ["dag.node.retried", 7],
        ["dag.node.steered", 8],
        ["dag.definition.amended", 9],
      ])
    })

    it("#when a retried node's attempt changes #then the whole-payload fingerprint redraws the snapshot channel", () => {
      // given a settled failed run already on the wire
      const failed = runSnapshot("dag_1", {
        status: "failed",
        nodes: [
          { id: "build", prompt: "build it", dependsOn: [], state: "failed", attempt: 1, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_build", error: { code: "task_error", message: "build exited 1" } },
        ],
      })
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([failed])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)
      expect(emittedNames(emitted, "omo.dag.updated")).toHaveLength(1)

      // when the retry re-runs the node: attempt bumps, error clears, nothing else moves
      setSnapshots([
        runSnapshot("dag_1", {
          status: "running",
          nodes: [
            { id: "build", prompt: "build it", dependsOn: [], state: "running", attempt: 2, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_build" },
          ],
        }),
      ])
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then the existing JSON.stringify fingerprint already saw the change: no new dedup code
      const updates = emittedNames(emitted, "omo.dag.updated")
      expect(updates).toHaveLength(2)
      const latest = updates[1]?.data as { runs: { nodes: { attempt: number; last_error?: unknown }[] }[] }
      expect(latest.runs[0]?.nodes[0]?.attempt).toBe(2)
      expect(latest.runs[0]?.nodes[0]).not.toHaveProperty("last_error")
    })

    it("#when only a node's last error changes #then the snapshot channel redraws", () => {
      // given a failed node already on the wire
      const first = runSnapshot("dag_1", {
        status: "failed",
        nodes: [
          { id: "build", prompt: "build it", dependsOn: [], state: "failed", attempt: 2, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_build", error: { code: "task_error", message: "build exited 1" } },
        ],
      })
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([first])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // when the second attempt fails differently: same state, same attempt, new error
      setSnapshots([
        runSnapshot("dag_1", {
          status: "failed",
          nodes: [
            { id: "build", prompt: "build it", dependsOn: [], state: "failed", attempt: 2, createdAt: "2026-08-14T00:00:00.000Z", taskId: "st_build", error: { code: "task_cancelled", message: "cancelled by operator" } },
          ],
        }),
      ])
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const updates = emittedNames(emitted, "omo.dag.updated")
      expect(updates).toHaveLength(2)
      const latest = updates[1]?.data as { runs: { nodes: { last_error?: { code: string; message: string } }[] }[] }
      expect(latest.runs[0]?.nodes[0]?.last_error).toEqual({ code: "task_cancelled", message: "cancelled by operator" })
    })

    it("#when the definition is amended #then amend_count reaches the wire and redraws", () => {
      // given an unamended run on the wire
      const { bridge, emitted, timers, setSnapshots } = wireSnapshots([runSnapshot("dag_1")])
      bridge.attach()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // when one amendment lands
      setSnapshots([runSnapshot("dag_1", { amendHistory: [{ at: "2026-08-14T00:01:00.000Z" }] })])
      bridge.notifyStoreMutation()
      timers.advance(DAG_SNAPSHOT_DEBOUNCE_MS)

      // then
      const updates = emittedNames(emitted, "omo.dag.updated")
      expect(updates).toHaveLength(2)
      expect((updates[0]?.data as { runs: Record<string, unknown>[] }).runs[0]).not.toHaveProperty("amend_count")
      expect((updates[1]?.data as { runs: { amend_count?: number }[] }).runs[0]?.amend_count).toBe(1)
    })
  })

  describe("#given a configured heartbeat interval", () => {
    it("#when task.dag.heartbeat_ms overrides the default #then beats follow the configured period", () => {
      // given
      const source = fakeRun("dag_1", "running")
      const { bridge, emitted, timers } = wire([source.run], { heartbeatMs: 5000 })
      bridge.attach()

      // when
      timers.advance(5000 * 2)

      // then
      expect(emittedNames(emitted, "omo.dag.heartbeat")).toHaveLength(2)
    })
  })
})
