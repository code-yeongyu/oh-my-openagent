// The assembled DAG engine over a real TaskManager for the admission-composition suites: the
// lower car's controlled runner and e2e fixture, plus one seam - an owned start can be held at a
// gate before it reaches the manager, so a test decides when a start in an open batch returns.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskManager } from "../manager/types"
import type { DagNodeInput } from "./graph"
import { RetryClock } from "./infra-retry-fixture"
import type { DagTaskOwnerScope } from "./owner"
import { createDagRunReservations } from "./run-reservations"
import { createDagScheduler } from "./scheduler"
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

export function cleanupAdmissionRoots(): void {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
}

type Gate = { readonly call: number; readonly reached: () => void; readonly released: Promise<void> }

export class GatedOwnedStarts {
  readonly calls: string[] = []
  readonly stopRequests: { readonly taskId: string; readonly reason: string | undefined }[] = []
  /** Called as a start reaches the manager, after any hold: what the run looked like then. */
  onStart: ((nodeId: string) => void) | undefined
  /** A node-scoped owned-task lookup throws this: a fault inside an admission step. */
  failNodeLookups: Error | undefined
  readonly #gates = new Map<string, Gate[]>()
  readonly #callWaiters = new Map<string, () => void>()

  hold(nodeId: string, call = 1): { readonly reached: Promise<void>; readonly release: () => void } {
    const reached = deferred<undefined>()
    const released = deferred<undefined>()
    const gates = this.#gates.get(nodeId) ?? []
    gates.push({ call, reached: () => reached.resolve(undefined), released: released.promise.then(() => undefined) })
    this.#gates.set(nodeId, gates)
    return { reached: reached.promise.then(() => undefined), release: () => released.resolve(undefined) }
  }

  whenCalled(nodeId: string): Promise<void> {
    if (this.calls.includes(nodeId)) return Promise.resolve()
    return new Promise((resolve) => this.#callWaiters.set(nodeId, resolve))
  }

  wrap(manager: TaskManager): TaskManager {
    return new Proxy(manager, {
      get: (target, property) => {
        if (property === "startOwned") {
          return async (...args: Parameters<TaskManager["startOwned"]>) => {
            const nodeId = String(args[1].nodeId)
            const call = this.calls.filter((entry) => entry === nodeId).length + 1
            const gate = this.#gates.get(nodeId)?.find((entry) => entry.call === call)
            if (gate !== undefined) {
              gate.reached()
              await gate.released
            }
            this.calls.push(nodeId)
            this.onStart?.(nodeId)
            this.#callWaiters.get(nodeId)?.()
            return target.startOwned(...args)
          }
        }
        if (property === "cancelTask") {
          return (...args: Parameters<TaskManager["cancelTask"]>) => {
            this.stopRequests.push({ taskId: args[0], reason: args[1] })
            return target.cancelTask(...args)
          }
        }
        if (property === "findOwnedTasks") {
          return (owner: DagTaskOwnerScope) => {
            if (this.failNodeLookups !== undefined && owner.nodeId !== undefined) throw this.failNodeLookups
            return target.findOwnedTasks(owner)
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
}

export async function admissionFixture(key: string, nodes: readonly DagNodeInput[]) {
  const project = fs.mkdtempSync(join(tmpdir(), "senpi-dag-admission-composition-"))
  roots.push(project)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const clock = new RetryClock()
  // No self-resume fence: a resumed child of an earlier attempt stays live, as a host-session child
  // outliving its process does (the lower car's stale-child cases do the same).
  const fixture = createE2eFixture({ project, runner, materializeSkills: identityMaterializer, resumeFence: false })
  const started = await fixture.manager.start({ definition: definition(key, nodes), parentSessionId, rootSessionId })
  const runId = started.snapshot.runId
  const starts = new GatedOwnedStarts()
  const scheduler = createDagScheduler({
    reservations: createDagRunReservations(),
    store: fixture.store,
    taskManager: starts.wrap(fixture.taskManager),
    initialRecord: fixture.manager.record(runId, parentSessionId),
    scheduleRetry: clock.schedule,
  })
  const taskOf = (nodeId: string): string => {
    const task = fixture.taskManager.findOwnedTasks({ kind: "dag", runId, nodeId: nodeId as DagNodeId }).at(0)
    if (task === undefined) throw new Error(`node ${nodeId} owns no task`)
    return task.task_id
  }
  const liveChildren = (): readonly string[] =>
    fixture.taskManager
      .findOwnedTasks({ kind: "dag", runId })
      .filter((task) => task.status === "pending" || task.status === "running" || task.status === "paused")
      .map((task) => task.task_id)
  const node = (nodeId: string) => scheduler.snapshot().nodes.find((entry) => String(entry.id) === nodeId)
  const whenNode = (nodeId: string, state: string): Promise<void> =>
    node(nodeId)?.state === state
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const unsubscribe = scheduler.subscribe((event: DagRunEvent) => {
            if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== state) return
            unsubscribe()
            resolve()
          })
        })
  return { fixture, runner, clock, starts, scheduler, runId, taskOf, liveChildren, node, whenNode }
}
