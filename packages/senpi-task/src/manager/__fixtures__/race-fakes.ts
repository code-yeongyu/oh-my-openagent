import type { ChildSession } from "../../runners/in-process/child-handle"
import { createChildHandle } from "../../runners/in-process/child-handle"
import type { ChildExitOutcome, RpcChildHandle } from "../../runners/types"
import type { DestructionCause, DestructionPort } from "../../steering"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { adaptInProcessHandle, adaptRpcHandle } from "../child-handle"
import type { ManagedChildHandle } from "../child-handle"
import { createTaskManager } from "../manager"
import type { ManagedRunner, ManagedStartSpec, TaskManager } from "../types"
import { categoryPlanner, settings, tempProject } from "./manager-fakes"

export type RaceFlavor = "in-process" | "rpc"

export const RACE_PARTIAL_TEXT = "partial answer so far"

// prompt() and abort() resolve off ONE idle signal, prompt registered first: the exact senpi
// agent-session ordering (agent-session.ts:1662-1684) that lets abort settle the launch-time
// outcome tracker BEFORE steering's post-await transition runs, so the tracker wins first-writer.
function oneIdleSession(): ChildSession {
  let fireIdle: () => void = () => {}
  const idle = new Promise<void>((resolve) => {
    fireIdle = resolve
  })
  return {
    sessionId: "sess-race",
    prompt: () => idle,
    steer: async () => {},
    followUp: async () => {},
    abort: async () => {
      fireIdle()
      await idle
    },
    subscribe: () => () => {},
    getLastAssistantText: () => RACE_PARTIAL_TEXT,
    dispose: () => {},
  }
}

// RPC flavor: abort settles waitForIdle and the clean (undefined) exit resolves rpcOutcome as
// 'completed' - the tracker then transitions complete, the RPC-side override race.
function oneIdleRpc(taskId: string): RpcChildHandle {
  let fireIdle: () => void = () => {}
  const idle = new Promise<void>((resolve) => {
    fireIdle = resolve
  })
  return {
    task_id: taskId,
    sessionId: `sess-${taskId}`,
    pid: 4321,
    steer: async () => {},
    followUp: async () => {},
    abort: async () => {
      fireIdle()
      await idle
    },
    subscribe: () => () => {},
    waitForIdle: () => idle,
    lastAssistantText: () => RACE_PARTIAL_TEXT,
    dispose: async () => {},
    terminate: async () => {},
    exitOutcome: () => undefined,
    waitForExit: () => new Promise<ChildExitOutcome>(() => {}),
    lastSeen: () => undefined,
  }
}

class RaceRunner implements ManagedRunner {
  readonly #flavor: RaceFlavor

  constructor(flavor: RaceFlavor) {
    this.#flavor = flavor
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle =
      this.#flavor === "in-process"
        ? adaptInProcessHandle(createChildHandle({ taskId: spec.taskId, session: oneIdleSession(), promptText: spec.prompt }))
        : adaptRpcHandle(oneIdleRpc(spec.taskId))
    return Promise.resolve(handle)
  }
}

export type RaceDestruction = DestructionPort & {
  readonly calls: Array<{ readonly taskId: string; readonly cause: DestructionCause }>
}

function makeRaceDestruction(): RaceDestruction {
  const calls: Array<{ readonly taskId: string; readonly cause: DestructionCause }> = []
  return {
    calls,
    destroyResidentTask: async (taskId, cause) => {
      calls.push({ taskId, cause })
    },
  }
}

export type RaceHarness = {
  readonly manager: TaskManager
  readonly store: TaskRecordStore
  readonly destruction: RaceDestruction
}

export function makeRaceHarness(flavor: RaceFlavor): RaceHarness {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const destruction = makeRaceDestruction()
  const runner = new RaceRunner(flavor)
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    destruction,
  })
  return { manager, store, destruction }
}
