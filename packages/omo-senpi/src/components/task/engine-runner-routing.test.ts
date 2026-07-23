import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import type {
  ExecutionMode,
  ManagedChildHandle,
  ManagedRunner,
  ManagedStartSpec,
  RunnerOutcome,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskRunnerFactories } from "./engine"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-engine-routing-"))
  tempRoots.push(dir)
  return dir
}

// A never-settling outcome handle: the routing test only asserts WHICH runner received the spec, so
// the child must not transition to terminal and clear the live bookkeeping before the assertion runs.
function fakeHandle(spec: ManagedStartSpec, pid: number | undefined): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    sessionId: undefined,
    pid,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForOutcome: () => new Promise<RunnerOutcome>(() => {}),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
}

type Spy = { readonly mode: ExecutionMode; readonly specs: ManagedStartSpec[]; readonly runner: ManagedRunner }

function spyRunner(mode: ExecutionMode, pid: number | undefined): Spy {
  const specs: ManagedStartSpec[] = []
  const runner: ManagedRunner = {
    start: (spec) => {
      specs.push(spec)
      return Promise.resolve(fakeHandle(spec, pid))
    },
  }
  return { mode, specs, runner }
}

function composeWithSpies(): { inProcess: Spy; process: Spy; engine: ReturnType<typeof composeTaskEngine> } {
  const cwd = tempProject()
  const inProcess = spyRunner("in-process", undefined)
  const process = spyRunner("process", 4242)
  const runnerFactories: TaskRunnerFactories = {
    inProcess: () => inProcess.runner,
    process: () => process.runner,
  }
  const engine = composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories,
  })
  return { inProcess, process, engine }
}

describe("task engine runner routing", () => {
  it("#given shared omo.json permits depth two #when the Senpi engine composes #then effective max depth is one", () => {
    // given
    const cwd = tempProject()

    // when
    const engine = composeTaskEngine({
      pi: new FakeExtensionAPI(),
      omoConfig: { task: OmoTaskSettingsSchema.parse({ max_depth: 2 }) },
      cwd,
      sharedParentTools: () => [],
    })

    // then
    expect(engine.settings.max_depth).toBe(1)
  })

  it("#given an invalid event task id #when the adapter appends an audit event #then store rejection is contained", () => {
    // given
    const { engine } = composeWithSpies()

    // when / then
    expect(() => engine.appendTaskEvent("not-a-task-id", { type: "probe", payload: {} })).not.toThrow()
  })

  it("#given a process-mode spawn #when the manager launches #then the process runner receives the spec and the in-process runner does not", async () => {
    // given the engine wired with distinct in-process and process runner spies
    const { inProcess, process, engine } = composeWithSpies()

    // when a task is started in process execution mode (explicit model bypasses the registry)
    const result = await engine.manager.start({
      prompt: "do the process work",
      parent_session_id: "session-a",
      depth: 1,
      caller_role: "coordinator",
      lineage: "known",
      execution_mode: "process",
      model: "omo-mock/mock-1",
      run_in_background: true,
    })

    // then the process runner got exactly one spec and the in-process runner got none
    expect(result.kind).toBe("started")
    expect(process.specs).toHaveLength(1)
    expect(inProcess.specs).toHaveLength(0)
  })

  it("#given an in-process spawn #when the manager launches #then the in-process runner receives the spec and the process runner does not", async () => {
    // given the same distinct-runner wiring
    const { inProcess, process, engine } = composeWithSpies()

    // when a task is started in in-process execution mode
    const result = await engine.manager.start({
      prompt: "do the in-process work",
      parent_session_id: "session-a",
      depth: 1,
      caller_role: "coordinator",
      lineage: "known",
      execution_mode: "in-process",
      model: "omo-mock/mock-1",
      run_in_background: true,
    })

    // then only the in-process runner was used
    expect(result.kind).toBe("started")
    expect(inProcess.specs).toHaveLength(1)
    expect(process.specs).toHaveLength(0)
  })
})
