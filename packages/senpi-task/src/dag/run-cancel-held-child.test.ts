import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskLifecycle } from "../lifecycle/create"
import { settings } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import type { ResidencyRegistry, ResidentHandle } from "../lifecycle/port"
import { adaptInProcessHandle, type ManagedChildHandle } from "../manager/child-handle"
import type { ManagedRunner, ManagedStartSpec, TaskManager } from "../manager/types"
import { heldWorkSession } from "../runners/in-process/__fixtures__/held-work-session"
import { createChildHandle, type RunnerOutcome } from "../runners/in-process/child-handle"
import { createManualSettlementScheduler, flushSettlement } from "../runners/rpc/turn-settlement.test-support"
import { createTaskRecordStore } from "../store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { liveRunChildren } from "./run-children-stop"
import { deferred, within } from "./scheduler-self-resume.test-harness"
import type { DagNodeId } from "./types"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type HeldChild = {
  readonly session: ReturnType<typeof heldWorkSession>
  readonly scheduler: ReturnType<typeof createManualSettlementScheduler>
  readonly handle: ManagedChildHandle
  outcome: RunnerOutcome | undefined
}

// The in-process runner's handle (createChildHandle, as InProcessRunner.start builds it) over a session
// whose first turn leaves a detached cell running.
class HeldWorkRunner implements ManagedRunner {
  readonly started = deferred<HeldChild>()

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const session = heldWorkSession(`child-${spec.taskId}`)
    const scheduler = createManualSettlementScheduler()
    const handle = adaptInProcessHandle(
      createChildHandle({
        taskId: spec.taskId,
        session: session.session,
        promptText: spec.prompt,
        asyncWork: { schedule: scheduler.scheduler, intervalMs: 1_000 },
      }),
    )
    const child: HeldChild = { session, scheduler, handle, outcome: undefined }
    void handle.waitForOutcome().then((outcome) => {
      child.outcome = outcome
    })
    this.started.resolve(child)
    return Promise.resolve(handle)
  }
}

function residentOf(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  return {
    task_id: handle.task_id,
    kind: "in-process",
    pid: undefined,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: async () => {},
  }
}

test("#10487 #given a node whose in-process child is held on its own detached cell #when the run is cancelled #then the child ends cancelled, its session is destroyed and no turn runs after", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-run-cancel-held-"))
  roots.push(root)
  const taskStore = createTaskRecordStore(ownedTaskState(root))
  const runner = new HeldWorkRunner()
  let taskManager: TaskManager | undefined
  const tasks = (): TaskManager => {
    if (taskManager === undefined) throw new Error("task manager used before the fixture was built")
    return taskManager
  }
  const registry: ResidencyRegistry = {
    get: (taskId) => residentOf(tasks().getResidentHandle(taskId)),
    entries: () => [],
    forget: (taskId, options) => tasks().forget(taskId, options),
    hasPendingSends: () => false,
  }
  const lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT,
    store: taskStore,
    registry,
    config: settings(),
  })
  const destroyed: string[] = []
  const fixture = createE2eFixture({
    project: root,
    runner,
    taskStore,
    materializeSkills: identityMaterializer,
    destruction: {
      destroyResidentTask: async (taskId, cause) => {
        destroyed.push(`${taskId}:${cause}`)
        await lifecycle.destroyResidentTask(taskId, cause)
      },
    },
  })
  taskManager = fixture.taskManager
  const started = await fixture.start(definition("cancel-held", [categoryNode("A")]))
  const runId = started.snapshot.runId
  const child = await within(runner.started.promise, 2_000, "the node's child to start")
  child.session.endTurnWithDetachedCell()
  await flushSettlement()
  const taskId = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (taskId === undefined) throw new Error("node A owns no task")
  expect(child.outcome).toBeUndefined()
  expect(fixture.taskStore.load(taskId)?.status).toBe("running")

  // when
  await fixture.cancel(runId, "stop the run")
  await flushSettlement()

  // then
  expect(child.outcome).toEqual({ status: "cancelled" })
  await within(child.session.whenDisposed, 2_000, "the held child's session to be destroyed")
  expect(destroyed).toEqual([`${taskId}:cancel`])
  const run = await fixture.running(runId)
  expect(run.status).toBe("cancelled")
  expect(run.nodes.find((node) => node.id === "A")?.state).toBe("cancelled")
  expect(liveRunChildren(fixture.taskManager, fixture.manager.record(runId, parentSessionId))).toEqual([])
  expect(fixture.taskStore.load(taskId)?.status).toBe("cancelled")
  child.session.finishWork()
  expect(child.session.agentStarts()).toBe(0)
  expect(fixture.taskStore.load(taskId)?.status).toBe("cancelled")
  lifecycle.dispose?.()
})
