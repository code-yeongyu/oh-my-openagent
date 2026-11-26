// #15133 stacked on #15134/#15135: the assembled DAG engine over a real TaskManager with the
// self-resume fence wired as the runtime wires it, for the cases where a child that finished starts a
// turn on its own while the run is running, cancelling or settled. Seams, all at a boundary: an owned
// start can be held at a gate (the lower car's GatedOwnedStarts), a hook runs after each stop answer,
// and the destruction port can be held per task so a refused turn's stop stays unconfirmed.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskManager } from "../manager/types"
import type { CancelOutcome } from "../steering"
import type { DagNodeInput } from "./graph"
import { RetryClock } from "./infra-retry-fixture"
import { createDagScheduler, type DagScheduler } from "./scheduler"
import { GatedOwnedStarts } from "./scheduler-admission-e2e.test-harness"
import { isLiveOwnedTask } from "./scheduler-context"
import { deferred } from "./scheduler-frontier.test-harness"
import type { DagNodeId, DagRunEvent } from "./types"
import {
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  rootSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner } from "./__fixtures__/controlled-runner"

const roots: string[] = []

export function cleanupSelfResumeRoots(): void {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
}

type StopHook = (taskId: string, outcome: CancelOutcome) => Promise<void> | void

export async function selfResumeE2e(key: string, nodes: readonly DagNodeInput[], resumeFence = true) {
  const project = fs.mkdtempSync(join(tmpdir(), "senpi-dag-self-resume-e2e-"))
  roots.push(project)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const destroyed: string[] = []
  const destroyGates = new Map<string, Promise<void>>()
  let scheduler: DagScheduler | undefined
  const fixture = createE2eFixture({
    project,
    runner,
    materializeSkills: identityMaterializer,
    resumeFence,
    cancelling: () => scheduler?.cancelling() ?? false,
    destruction: {
      destroyResidentTask: async (taskId, cause) => {
        destroyed.push(`${taskId}:${cause}`)
        await destroyGates.get(taskId)
      },
    },
    // A stop step is never cut short by a clock here: confirmation is decided by the gates alone.
    teardownStepDeadline: () => new Promise<void>(() => undefined),
  })
  const started = await fixture.manager.start({ definition: definition(key, nodes), parentSessionId, rootSessionId })
  const runId = started.snapshot.runId
  const starts = new GatedOwnedStarts()
  let afterStop: StopHook | undefined
  const gated = starts.wrap(fixture.taskManager)
  const taskManager = new Proxy(gated, {
    get: (target, property) => {
      if (property === "cancelTask") {
        return async (...args: Parameters<TaskManager["cancelTask"]>) => {
          const outcome = await target.cancelTask(...args)
          await afterStop?.(args[0], outcome)
          return outcome
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const clock = new RetryClock()
  scheduler = createDagScheduler({
    store: fixture.store,
    taskManager,
    initialRecord: fixture.manager.record(runId, parentSessionId),
    scheduleRetry: clock.schedule,
  })
  const run = scheduler
  const taskOf = (nodeId: string): string => {
    const task = fixture.taskManager.findOwnedTasks({ kind: "dag", runId, nodeId: nodeId as DagNodeId }).at(0)
    if (task === undefined) throw new Error(`node ${nodeId} owns no task`)
    return task.task_id
  }
  // Live by the run-wide rule: not settled, or a refused turn whose stop is not confirmed yet.
  const liveChildren = (): readonly string[] =>
    fixture.taskManager
      .findOwnedTasks({ kind: "dag", runId })
      .filter((task) => isLiveOwnedTask(fixture.taskManager, task))
      .map((task) => task.task_id)
  const holdDestroy = (taskId: string): (() => void) => {
    const gate = deferred<undefined>()
    destroyGates.set(
      taskId,
      gate.promise.then(() => undefined),
    )
    return () => gate.resolve(undefined)
  }
  const reopenedNodes = (): readonly string[] =>
    fixture.store
      .readEvents(runId, 0, { limit: 500 })
      .events.filter(
        (event: DagRunEvent) =>
          event.type === "dag.node.transitioned" && event.from === "completed" && event.to === "running",
      )
      .map((event) => (event.type === "dag.node.transitioned" ? String(event.nodeId) : ""))
  return {
    fixture,
    runner,
    starts,
    clock,
    scheduler: run,
    runId,
    destroyed,
    taskOf,
    liveChildren,
    holdDestroy,
    reopenedNodes,
    onStopAnswered: (hook: StopHook | undefined) => {
      afterStop = hook
    },
    node: (nodeId: string) => run.snapshot().nodes.find((entry) => String(entry.id) === nodeId),
  }
}
