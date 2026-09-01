import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import { createTaskLifecycle } from "../lifecycle"
import type { ResidentHandle, ResidencyRegistry, TaskLifecycle } from "../lifecycle"
import { createTaskManager } from "../manager"
import type { ChildPlanner, ManagedChildHandle, TaskManager } from "../manager"
import type { DestructionPort } from "../steering"
import type { TaskRecordStore } from "../store"
import { ChaosProcessTable, ChaosRpcRespawnRunner, ChaosRunner } from "./chaos-engine"
import type { LifecycleChaosObservations } from "./chaos-engine"

export type ChaosEngine = {
  readonly id: string
  readonly hostPid: number
  readonly manager: ReturnType<typeof createTaskManager>
  readonly lifecycle: TaskLifecycle
  readonly registry: ResidencyRegistry
  readonly inProcessRunner: ChaosRunner
  readonly processRunner: ChaosRunner
}

function managerRegistry(getManager: () => TaskManager): ResidencyRegistry {
  const adapt = (handle: ManagedChildHandle | undefined): ResidentHandle | undefined => handle === undefined ? undefined : {
    task_id: handle.task_id,
    kind: handle.pid === undefined ? "in-process" : "rpc",
    pid: handle.pid,
    abort: () => handle.abort(),
    terminate: () => handle.terminate?.() ?? Promise.resolve(),
    dispose: () => {
      const dispose = handle.dispose
      return dispose()
    },
  }
  return {
    get: (taskId) => adapt(getManager().getResidentHandle(taskId)),
    entries: () => getManager().residentTaskIds().map((id) => adapt(getManager().getResidentHandle(id))).filter((handle): handle is ResidentHandle => handle !== undefined),
    forget: (taskId) => getManager().forget(taskId),
    hasPendingSends: () => false,
  }
}

function singleModelPlanner(model: string): ChildPlanner {
  return (spec) => ({ kind: "resolved", plan: { model: spec.model ?? model } })
}

export function buildChaosEngines(input: {
  readonly store: TaskRecordStore
  readonly config: OmoTaskSettings
  readonly clock: () => number
  readonly project: string
  readonly model: string
  readonly processes: ChaosProcessTable
  readonly observations: LifecycleChaosObservations
}): readonly ChaosEngine[] {
  const engines: ChaosEngine[] = []
  for (let index = 0; index < 3; index += 1) {
    const id = `engine-${index + 1}`
    const hostPid = 10_000 + index
    input.processes.alive.add(hostPid)
    let managerRef: ReturnType<typeof createTaskManager> | undefined
    const getManager = (): ReturnType<typeof createTaskManager> => {
      if (managerRef === undefined) throw new Error(`${id} manager unavailable`)
      return managerRef
    }
    const registry = managerRegistry(getManager)
    const inProcessRunner = new ChaosRunner({
      engineId: id, mode: "in-process", store: input.store,
      processes: input.processes, observations: input.observations,
    })
    const processRunner = new ChaosRunner({
      engineId: id, mode: "process", store: input.store,
      processes: input.processes, observations: input.observations,
    })
    const lifecycle = createTaskLifecycle({
      store: input.store, registry, config: input.config, now: input.clock,
      signaller: input.processes, hostPid, orphanKillDelayMs: 0,
      respawn: (record, sessionPath) => getManager().respawn(record, sessionPath),
      reattach: (record, handle) => getManager().reattach(record, handle),
    })
    const destruction: DestructionPort = {
      destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel"),
    }
    managerRef = createTaskManager({
      store: input.store,
      runners: { "in-process": inProcessRunner, process: processRunner },
      planner: singleModelPlanner(input.model), config: input.config, cwd: input.project,
      now: input.clock, destruction,
      admit: async (parentSessionId) => {
        const result = await lifecycle.admitResident(parentSessionId)
        return result.kind === "rejected" ? { kind: "rejected", message: result.error.message } : result
      },
      rpcRespawnRunner: new ChaosRpcRespawnRunner(input.store, input.processes, input.observations),
      hostPid,
    })
    engines.push({ id, hostPid, manager: managerRef, lifecycle, registry, inProcessRunner, processRunner })
  }
  return engines
}
