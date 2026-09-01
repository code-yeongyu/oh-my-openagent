import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  createTaskRecord,
  createTaskRecordStore,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
  type TaskRecord,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine, type TaskRunnerFactories } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"
import { createTaskTerminalObservers, type TaskTerminalEdge } from "./terminal-observers"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

class ScriptedRunner implements ManagedRunner {
  readonly outcomes: Array<ReturnType<typeof deferred<RunnerOutcome>>> = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = deferred<RunnerOutcome>()
    this.outcomes.push(outcome)
    const handle: ManagedChildHandle = {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        outcome.resolve({ status: "cancelled" })
        return Promise.resolve()
      },
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
    return Promise.resolve(handle)
  }
}

type Fixture = {
  readonly engine: TaskEngine
  readonly runner: ScriptedRunner
  readonly project: string
  readonly edges: TaskTerminalEdge[]
}

function fixture(): Fixture {
  const project = mkdtempSync(join(tmpdir(), "omo-senpi-engine-terminal-"))
  roots.push(project)
  const runner = new ScriptedRunner()
  const runnerFactories: TaskRunnerFactories = { inProcess: () => runner, process: () => runner }
  const observers = createTaskTerminalObservers()
  const edges: TaskTerminalEdge[] = []
  observers.subscribe((edge) => edges.push(edge))
  const engine = composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig: loadOmoConfig({ cwd: project }).config,
    cwd: project,
    sharedParentTools: () => [],
    runnerFactories,
    terminalObservers: observers,
  })
  engine.runtime.captureFrom({
    mode: "tui",
    ui: {
      notify: () => undefined,
      setStatus: () => undefined,
      setWidget: () => undefined,
      select: async () => undefined,
      confirm: async () => false,
    },
    sessionManager: { getSessionId: () => "parent-session" },
    isIdle: () => true,
  })
  return { engine, runner, project, edges }
}

async function spawn(engine: TaskEngine, name: string): Promise<string> {
  const result = await engine.manager.start({
    prompt: `work ${name}`,
    parent_session_id: "parent-session",
    depth: 0,
    model: "anthropic/claude-opus-5",
    name,
  })
  if (result.kind !== "started") throw new Error(`spawn failed: ${result.kind}`)
  return result.task_id
}

async function settledStatus(engine: TaskEngine, taskId: string): Promise<TaskStatus> {
  const record = await engine.manager.waitFor(taskId)
  return record.status
}

describe("task engine terminal edge observation", () => {
  test("#given a composed engine #when tasks reach completed, error, cancelled and interrupted #then exactly one ledger edge fires per task", async () => {
    // given
    const { engine, runner, edges } = fixture()
    const completedId = await spawn(engine, "completes")
    const failedId = await spawn(engine, "fails")
    const cancelledId = await spawn(engine, "cancels")
    const interruptedId = await spawn(engine, "interrupts")

    // when
    runner.outcomes[0]?.resolve({ status: "completed", finalResponse: "done" })
    runner.outcomes[1]?.resolve({ status: "error", failure: { kind: "child-turn-failed", message: "boom" } })
    await engine.manager.cancelTask(cancelledId, "no longer needed")
    await engine.manager.interruptTask(interruptedId)

    // then
    const statuses = await Promise.all([
      settledStatus(engine, completedId),
      settledStatus(engine, failedId),
      settledStatus(engine, cancelledId),
      settledStatus(engine, interruptedId),
    ])
    expect(statuses).toEqual(["completed", "error", "cancelled", "interrupted"])
    for (const taskId of [completedId, failedId, cancelledId, interruptedId]) {
      expect(edges.filter((edge) => edge.record.task_id === taskId)).toHaveLength(1)
    }
  })

  test("#given a live model registry #when a task is planned and claimed #then the record carries the planning config generation", async () => {
    // given
    const { engine, project } = fixture()
    engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry() })

    // when
    const taskId = await spawn(engine, "stamped")

    // then
    const persisted = createTaskRecordStore({ project_dir: project }).load(taskId)
    expect(persisted?.config_generation).toBe(0)
    expect(engine.categoryConfigGenerations.current()?.generation).toBe(0)
  })

  test("#given a resident record owned by a dead host #when the lifecycle reconciles it lost through replace #then exactly one ledger edge fires", async () => {
    // given
    const { engine, project, edges } = fixture()
    const sibling = createTaskRecordStore({ project_dir: project })
    // A previous process's in-process child of ANOTHER session: the global crash sweep writes `lost`
    // through store.replace, the path the transition-only completion bridge cannot observe.
    const orphan: TaskRecord = {
      ...createTaskRecord({
        parent_session_id: "previous-session",
        root_session_id: "previous-session",
        depth: 0,
        execution_mode: "in-process",
        model: "anthropic/claude-opus-5",
        notify_on_terminal: true,
      }),
      status: "running",
      residency_state: "resident",
      host_pid: 999_999,
    }
    sibling.save(orphan)

    // when
    await engine.lifecycle.reconcileOnSessionStart("parent-session")

    // then
    const lostEdges = edges.filter((edge) => edge.record.task_id === orphan.task_id)
    expect(lostEdges).toHaveLength(1)
    expect(lostEdges[0]?.record.status).toBe("lost")
    expect(lostEdges[0]?.previousStatus).toBe("running")
  })
})
