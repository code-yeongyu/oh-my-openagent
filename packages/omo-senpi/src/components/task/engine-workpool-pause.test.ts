import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createEngineRunPause } from "./engine-run-pause"
import type { RunnerOutcome } from "../../../../senpi-task/src/manager/child-handle"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${name} did not settle`)), 5000) })
  return Promise.race([promise, expired]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

test("a workpool child created across Stop is held before its first provider call and registered under its pool", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const creating = Promise.withResolvers<void>()
  const bind = Promise.withResolvers<void>()
  const resumedTurn = Promise.withResolvers<RunnerOutcome>()
  let stopped = true
  let pauseSeq = 7
  let resumes = 0
  let providers = 0
  let graph: ReturnType<typeof createEngineRunPause>
  const manager = createTaskManager({
    cwd, store, config: settings(), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    onPausedChild: (record, owner, childSeq) => graph.notePausedChild(record, owner, childSeq),
    childCreationPort: { startPaused: async (spec, backend, ticket) => {
      creating.resolve()
      await bind.promise
      const child = await backend.start(spec)
      return { child, activate: async () => {
        const decision = ticket.commit()
        if (decision.kind === "start_paused") return { kind: "paused", owner: decision.owner, childSeq: 13 }
        providers++
        return { turnId: "first", outcome: child.waitForOutcome() }
      } }
    } },
    childPausePort: {
      pauseForRun: async () => {
        expect(pauseSeq).toBe(8)
        return { childSeq: 15 }
      },
      resumeTurn: async (_child, request) => {
        if (++resumes === 1) {
          expect(request.childSeqCutoff).toBe(13)
          return { otherHoldLive: true, childSeq: 14 }
        }
        expect(request.childSeqCutoff).toBe(15)
        providers++
        return { turnId: "resumed-turn", outcome: resumedTurn.promise }
      },
      holdInput: async () => { throw new Error("no guidance was submitted") },
    },
  })
  const fences: string[] = []
  graph = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: {
      getPauseState: () => ({ pauseSeq, holds: stopped ? [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }] : [] }),
      fenceRun: ref => { fences.push(`${ref.kind}:${ref.id}`) },
    },
  })
  const caller = { sessionId: "parent", rootSessionId: "parent", depth: 0, cwd }
  const pool = manager.workpools.create(caller, { name: "workers", agent: { category: "quick", prompt: "work" } })
  const observedCreation = bounded(creating.promise, "pool child creation")
  let pausing: Promise<void> | undefined
  try {
    manager.workpools.push(caller, pool.pool_id, [{ key: "one", input: 1 }])
    await observedCreation
    pausing = graph.bridge.changed("parent", { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }], change: "paused" })
    bind.resolve()
    await bounded(pausing, "pool run pause")
    const paused = manager.workpools.inspect(caller, pool.pool_id)
    expect(paused).toMatchObject({
      generation: pool.generation, hold: { reason: "user_stop", pauseSeq: 7 },
      workers: [{ status: "paused", run_epoch: 0 }], items: [{ status: "assigned" }],
    })
    expect(providers).toBe(0)
    expect(fences).toContain(`workpool:${pool.pool_id}`)
    const participant = Object.values(graph.registry.require("parent").participants).find(entry => entry.kind === "workpool_worker")
    expect(participant).toMatchObject({ state: "held", observedChildSeq: 13, runRef: { kind: "workpool", id: pool.pool_id } })
    expect(graph.registry.require("parent").phase).toBe("applied")
    stopped = false
    await bounded(graph.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" }), "pool run Resume")
    await graph.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
    expect(providers).toBe(0)
    expect(manager.workpools.inspect(caller, pool.pool_id).workers[0]?.status).toBe("paused")
    pauseSeq = 8
    stopped = true
    await bounded(graph.bridge.changed("parent", { pauseSeq: 8, holds: [{ kind: "session_hold", key: "session_hold:8" }], change: "paused" }), "second pool Stop")
    stopped = false
    await bounded(graph.bridge.changed("parent", { pauseSeq: 8, holds: [], change: "resumed" }), "second pool Resume")
    expect(providers).toBe(1)
    expect(runner.startedSpecs).toHaveLength(1)
    expect(manager.workpools.inspect(caller, pool.pool_id)).toMatchObject({
      generation: pool.generation, workers: [{ status: "busy", run_epoch: 0 }],
      items: [{ status: "assigned", delivery: { phase: "acknowledged" } }],
    })
    if (participant?.taskId === undefined) throw new Error("pool worker task identity is missing")
    // An empty steering queue is stored as an absent field (createTaskRecord, clearPersistedQueue).
    const worker = manager.get(participant.taskId)
    expect(worker).toBeDefined()
    expect(worker?.pending_steering).toBeUndefined()
  } finally {
    bind.resolve()
    await pausing?.catch(() => undefined)
    resumedTurn.resolve({ status: "cancelled" })
    for (const { record } of manager.list({ scope: "all" })) await manager.cancelTask(record.task_id)
    manager.workpools.dispose()
  }
}, 15000)
