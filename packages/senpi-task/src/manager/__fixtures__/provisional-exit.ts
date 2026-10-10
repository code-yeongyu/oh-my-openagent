import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createTaskLifecycle } from "../../lifecycle/create"
import { FakeRegistry, readEvents } from "../../lifecycle/__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "../../lifecycle/host-session"
import { classifyChildExit } from "../../runners/rpc/exit-mapping"
import { exitTurnOutcome } from "../../runners/rpc/turn-outcome"
import { resolveChildSessionDir } from "../../runners/rpc/spawn"
import { createTaskRecordStore, type TaskRecordStore } from "../../store"
import { createTaskManager } from "../manager"
import { baseSpec, categoryPlanner, FakeRunner, makeHandle, settings, tempProject } from "./manager-fakes"

export function exitClock() {
  let time = Date.parse("2026-10-10T00:00:00.000Z")
  const timers = new Map<() => void, number>()
  const schedule = (callback: () => void, ms: number): (() => void) => {
    timers.set(callback, time + ms)
    return () => { timers.delete(callback) }
  }
  return {
    now: () => time,
    schedule,
    advance: (ms: number) => {
      time += ms
      for (const [callback, due] of [...timers]) {
        if (due > time) continue
        timers.delete(callback)
        callback()
      }
    },
    fireEarly: () => {
      const callback = timers.keys().next().value
      if (callback === undefined) throw new Error("no confirmation timer")
      timers.delete(callback)
      callback()
    },
    size: () => timers.size,
  }
}

export async function exitedTask(
  wrap: (store: TaskRecordStore) => TaskRecordStore = (store) => store,
  clock = exitClock(),
) {
  const project = tempProject()
  const backing = createTaskRecordStore({ project_dir: project })
  const observed = Promise.withResolvers<void>()
  const store = wrap({
    ...backing,
    appendEvent: (id, event) => {
      const result = backing.appendEvent(id, event)
      if (event.type === "child_exit_provisional") observed.resolve()
      return result
    },
    transition: (id, transition) => {
      const result = backing.transition(id, transition)
      if (transition.type === "fail") observed.resolve()
      return result
    },
  })
  const runner = new FakeRunner()
  runner.childPid = 900
  const config = settings({ reattach_on_reconcile: true })
  const manager = createTaskManager({
    store, config, cwd: project, now: clock.now,
    scheduleExitConfirmation: (callback, ms) => {
      const cancel = clock.schedule(callback, ms)
      observed.resolve()
      return cancel
    },
    runners: { "in-process": new FakeRunner(), process: runner }, planner: categoryPlanner(),
  })
  const started = await manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))
  if (started.kind !== "started") throw new Error(`start refused: ${started.kind}`)
  const taskId = started.task_id
  const child = runner.handles.get(taskId)
  if (child === undefined) throw new Error("missing child")
  const sessionDir = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, "transcript.jsonl"), "{}\n")
  child.settle(exitTurnOutcome(classifyChildExit({
    code: 1, signal: null, pid: 900, stderr: "", terminatedByRunner: false,
  }), undefined))
  await observed.promise

  let respawns = 0
  const lifecycle = createTaskLifecycle({
    store, registry: new FakeRegistry(), config, now: clock.now, hostPid: process.pid + 100000,
    hostEndpoint: NO_HOST_ENDPOINT, signaller: { isAlive: () => false, signal: () => {} },
    respawn: async (record) => { respawns += 1; return { ok: true, handle: makeHandle(record.task_id, 901).handle } },
    reattach: async () => ({ ok: true }),
  })
  return {
    manager, store, backing, taskId, clock, lifecycle, respawns: () => respawns,
    events: () => readEvents(store, taskId),
    dispose: () => { manager.forget(taskId); lifecycle.dispose?.() },
  }
}
