import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createEngineRunPause } from "./engine-run-pause"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${name} did not settle`)), 5000) })
  return Promise.race([promise, expired]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

test("Stop pauses attached children before waiting for a staged birth, then freezes its acknowledgement", async () => {
  const cwd = tempProject()
  const backing = createTaskRecordStore({ project_dir: cwd })
  const existingPaused = Promise.withResolvers<void>()
  let existingId: string | undefined
  const store = { ...backing, transition: (...args: Parameters<typeof backing.transition>) => {
    const result = backing.transition(...args)
    if (result.applied && args[0] === existingId && args[1].type === "pause") existingPaused.resolve()
    return result
  } }
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const creating = Promise.withResolvers<void>()
  const bind = Promise.withResolvers<void>()
  let providers = 0
  let creations = 0
  let graph: ReturnType<typeof createEngineRunPause>
  const manager = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 2 }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childCreationPort: {
      startPaused: async (spec, backend, ticket) => {
        if (++creations > 1) { creating.resolve(); await bind.promise }
        const child = await backend.start(spec)
        return { child, activate: async () => {
          const decision = ticket.commit()
          if (decision.kind === "start_paused") return { kind: "paused", owner: decision.owner, childSeq: 11 }
          providers++
          return { turnId: "first", outcome: child.waitForOutcome() }
        } }
      },
    },
    onPausedChild: (record, owner, childSeq) => graph.notePausedChild(record, owner, childSeq),
    childPausePort: {
      pauseForRun: async child => {
        if (existingId === undefined) throw new Error("the attached child identity is missing")
        expect(child.task_id).toBe(existingId)
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 5 }
      },
      resumeTurn: async () => { throw new Error("Resume was not requested") },
      holdInput: async () => { throw new Error("no guidance was submitted") },
    },
  })
  graph = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: { getPauseState: () => ({ pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }), fenceRun: () => undefined },
  })
  const existing = await bounded(manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" })), "existing child start")
  if (existing.kind !== "started") throw new Error("expected the existing child to start")
  await bounded(launchSettled(manager, existing.task_id), "existing child launch")
  existingId = existing.task_id
  expect(providers).toBe(1)
  const observedCreation = bounded(creating.promise, "staged creation")
  const starting = manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  let pausing: Promise<void> | undefined
  try {
    await observedCreation
    pausing = graph.bridge.changed("parent", {
      change: "paused", pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }],
    })
    await bounded(Promise.race([existingPaused.promise, pausing]), "attached child pause")
    expect(manager.get(existingId)?.status).toBe("paused")
    expect(graph.registry.require("parent").phase).toBe("propagating")
    bind.resolve()
    const started = await starting
    if (started.kind !== "held" && started.kind !== "started") throw new Error(`unexpected start receipt: ${started.kind}`)
    await bounded(pausing, "staged birth pause")
    await bounded(launchSettled(manager, started.task_id), "staged child launch settlement")
    expect(providers).toBe(1)
    const entries = Object.values(graph.registry.require("parent").participants)
    expect(entries).toHaveLength(2)
    const participant = entries.find(entry => entry.taskId === started.task_id)
    expect(participant).toMatchObject({ state: "held", ackSeq: 7, observedChildSeq: 11 })
    if (participant?.taskId === undefined) throw new Error("paused birth is missing its task identity")
    expect(manager.get(participant.taskId)?.status).toBe("paused")
    expect(graph.registry.require("parent").phase).toBe("applied")
  } finally {
    bind.resolve()
    await starting.catch(() => undefined)
    for (const { record } of manager.list({ scope: "all" })) await manager.cancelTask(record.task_id)
    await pausing?.catch(() => undefined)
    manager.workpools.dispose()
  }
}, 15000)
