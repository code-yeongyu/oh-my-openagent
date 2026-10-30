import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import type { DestroyCause } from "../lifecycle/port"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { TaskConcurrency } from "./concurrency"
import { createTaskManager } from "./manager"
import type { ManagedStartSpec } from "./types"

// senpi#3266 review: re-dispatch must work with the REAL destruction port, wired exactly as
// omo-senpi's engine wires it (components/task/engine.ts). A mock that skips teardown hid that the
// port's residency `dispose` left the record un-reattachable.

afterEach(cleanupProjects)

const OWNER_PID = 21_001

class CountingRunner extends FakeRunner {
  readonly disposed = new Map<ManagedChildHandle, number>()
  readonly aborted = new Map<ManagedChildHandle, number>()

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    const counted: ManagedChildHandle = Object.assign(handle, {
      dispose: async () => {
        this.disposed.set(counted, (this.disposed.get(counted) ?? 0) + 1)
      },
      abort: async () => {
        this.aborted.set(counted, (this.aborted.get(counted) ?? 0) + 1)
      },
    })
    return counted
  }
}

type LaneOptions = {
  readonly withDestructionPort?: boolean
  // Runs inside the re-dispatch teardown, before the lifecycle tears the old child down.
  readonly duringRedispatchTeardown?: { current?: () => Promise<void> }
}

function productionLane(options: LaneOptions = {}) {
  const runner = new CountingRunner()
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const config = settings({ default_concurrency: 1, global_concurrency: 1, max_depth: 1 })
  const concurrency = new TaskConcurrency(config)
  const hook = options.duringRedispatchTeardown
  const manager = createTaskManager({
    store,
    config,
    concurrency,
    cwd: "/tmp",
    hostPid: OWNER_PID,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    ...(options.withDestructionPort === false ? {} : {
      destruction: {
        destroyResidentTask: async (taskId: string, cause: DestroyCause) => {
          const during = hook?.current
          if (cause === "redispatch" && hook !== undefined && during !== undefined) {
            hook.current = undefined
            await during()
          }
          await lifecycle.destroyResidentTask(taskId, cause)
        },
        parkTerminalResident: (taskId: string) => lifecycle.parkTerminalResident(taskId),
      },
    }),
  })
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, config, hostPid: OWNER_PID, registry: createManagerResidencyRegistry(() => manager) })
  const dispose = (): void => {
    lifecycle.dispose?.()
    manager.workpools.dispose()
    for (const taskId of manager.residentTaskIds()) manager.forget(taskId, { path: "end" })
  }
  return { runner, store, manager, concurrency, dispose }
}

async function flaggedOn(lane: ReturnType<typeof productionLane>) {
  const started = await lane.manager.start(baseSpec({ prompt: "build the report" }))
  if (started.kind !== "started") throw new Error(`expected started, got ${started.kind}`)
  lane.store.mutate(started.task_id, (record) => ({ ...record, awaiting_input: { reason: "resumed_turn_aborted", since: new Date().toISOString() } }))
  const oldHandle = lane.manager.getResidentHandle(started.task_id)
  if (oldHandle === undefined) throw new Error("expected a live handle")
  return { taskId: started.task_id, oldHandle }
}

describe("TaskManager.redispatchTask with the real destruction port (senpi#3266)", () => {
  test("#given a flagged resident task #when it is re-dispatched #then a fresh child is attached, the record stays resident and running, and the old child is torn down", async () => {
    // given
    const lane = productionLane()
    try {
      const started = await lane.manager.start(baseSpec({ prompt: "build the report" }))
      if (started.kind !== "started") throw new Error(`expected started, got ${started.kind}`)
      const taskId = started.task_id
      lane.store.mutate(taskId, (record) => ({ ...record, awaiting_input: { reason: "resumed_turn_aborted", since: new Date().toISOString() } }))
      const oldHandle = lane.manager.getResidentHandle(taskId)
      if (oldHandle === undefined) throw new Error("expected a live handle")
      const before = lane.store.load(taskId)?.notification.run_epoch ?? -1

      // when
      const outcome = await lane.manager.redispatchTask(taskId, "parent-1")

      // then
      expect(outcome).toMatchObject({ kind: "redispatched", task_id: taskId })
      const record = lane.store.load(taskId)
      expect(record?.status).toBe("running")
      expect(record?.residency_state).toBe("resident")
      expect(record?.host_pid).toBe(OWNER_PID)
      expect(record?.awaiting_input).toBeUndefined()
      expect(record?.notification.run_epoch ?? -1).toBeGreaterThan(before)
      const freshHandle = lane.manager.getResidentHandle(taskId)
      expect(freshHandle).toBeDefined()
      expect(freshHandle).not.toBe(oldHandle)
      expect(lane.runner.disposed.get(oldHandle) ?? 0).toBe(1)
      expect(lane.runner.aborted.get(oldHandle) ?? 0).toBe(1)
      expect(lane.runner.startedSpecs.map((spec) => spec.prompt)).toEqual(["build the report", "build the report"])
    } finally {
      lane.dispose()
    }
  })

  test("#given two re-dispatches of one flagged task at once #when both settle #then exactly one fresh child launches and the lane still holds one slot", async () => {
    // given
    const lane = productionLane()
    try {
      const { taskId } = await flaggedOn(lane)

      // when
      const outcomes = await Promise.all([
        lane.manager.redispatchTask(taskId, "parent-1"),
        lane.manager.redispatchTask(taskId, "parent-1"),
      ])

      // then
      expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual(["invalid_state", "redispatched"])
      expect(lane.runner.startedSpecs).toHaveLength(2)
      expect(lane.manager.residentTaskIds()).toEqual([taskId])
      expect(lane.concurrency.hasFreeSlot("anthropic/claude")).toBe(false)
    } finally {
      lane.dispose()
    }
  })

  test("#given a cancel that lands while the old session is closing #when the re-dispatch resumes #then nothing is spawned, the cancel stands, and the slot is free", async () => {
    // given
    const duringRedispatchTeardown: { current?: () => Promise<void> } = {}
    const lane = productionLane({ duringRedispatchTeardown })
    try {
      const { taskId } = await flaggedOn(lane)
      duringRedispatchTeardown.current = async () => {
        await lane.manager.cancelTask(taskId)
      }

      // when
      const outcome = await lane.manager.redispatchTask(taskId, "parent-1")

      // then
      expect(outcome.kind).toBe("invalid_state")
      expect(lane.store.load(taskId)?.status).toBe("cancelled")
      expect(lane.runner.startedSpecs).toHaveLength(1)
      expect(lane.manager.residentTaskIds()).toEqual([])
      expect(lane.concurrency.hasFreeSlot("anthropic/claude")).toBe(true)
    } finally {
      lane.dispose()
    }
  })
  test("#given the flag is withdrawn while the old session is closing #when the re-dispatch resumes #then a fresh child still launches instead of stranding the task", async () => {
    // given: a delivery that read the old handle before the abandon withdraws the flag mid-teardown
    const duringRedispatchTeardown: { current?: () => Promise<void> } = {}
    const lane = productionLane({ duringRedispatchTeardown })
    try {
      const { taskId, oldHandle } = await flaggedOn(lane)
      duringRedispatchTeardown.current = async () => {
        lane.store.mutate(taskId, (record) => {
          const { awaiting_input: _withdrawn, ...rest } = record
          return rest
        })
      }

      // when
      const outcome = await lane.manager.redispatchTask(taskId, "parent-1")

      // then
      expect(outcome).toMatchObject({ kind: "redispatched", task_id: taskId })
      const record = lane.store.load(taskId)
      expect(record?.status).toBe("running")
      expect(record?.residency_state).toBe("resident")
      const freshHandle = lane.manager.getResidentHandle(taskId)
      expect(freshHandle).toBeDefined()
      expect(freshHandle).not.toBe(oldHandle)
      expect(lane.runner.startedSpecs).toHaveLength(2)
      expect(lane.concurrency.hasFreeSlot("anthropic/claude")).toBe(false)
    } finally {
      lane.dispose()
    }
  })
})

describe("TaskManager.redispatchTask without a destruction port (senpi#3266)", () => {
  test("#given a minimal manager #when a flagged task is re-dispatched #then the old child is still disposed", async () => {
    // given
    const lane = productionLane({ withDestructionPort: false })
    try {
      const { taskId, oldHandle } = await flaggedOn(lane)

      // when
      const outcome = await lane.manager.redispatchTask(taskId, "parent-1")

      // then
      expect(outcome.kind).toBe("redispatched")
      expect(lane.runner.disposed.get(oldHandle) ?? 0).toBe(1)
      expect(lane.manager.getResidentHandle(taskId)).not.toBe(oldHandle)
    } finally {
      lane.dispose()
    }
  })
})
