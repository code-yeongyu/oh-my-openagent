import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec, RunnerOutcome } from "@oh-my-opencode/senpi-task"
import * as dagEngine from "@oh-my-opencode/senpi-task/dag"
import { createDagManager, type DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import type { DagRunId } from "../../../../senpi-task/src/dag/types"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { loadSenpiOmoConfig } from "../config-resolution"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import { runDagTool } from "./dag-tool"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

// A long-lived orchestrator keeps one task engine for its whole session, and a workflow (DAG) node starts its child
// through that engine's planner. An omo.json category edit must reach the next node a workflow run starts, including a
// run recovered from disk, while a child already running keeps the model it was planned on (#11539).

const sessionId = "session-dag-category-config"
const MODEL_A = "acme/model-a"
const MODEL_B = "acme-b/model-b"
const createFileStore = createDagFileStore
const roots: string[] = []
const runtimes: DagRuntime[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function writeCategoryModel(project: string, model: string): void {
  fs.mkdirSync(join(project, ".omo"), { recursive: true })
  fs.writeFileSync(join(project, ".omo", "omo.json"), `${JSON.stringify({ categories: { quick: { model } } })}\n`)
}

class CapturingRunner implements ManagedRunner {
  readonly specs: ManagedStartSpec[] = []
  readonly #waiters = new Map<number, () => void>()
  readonly #outcomes: ((outcome: RunnerOutcome) => void)[] = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = new Promise<RunnerOutcome>((resolve) => this.#outcomes.push(resolve))
    this.specs.push(spec)
    this.#waiters.get(this.specs.length)?.()
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      // Children stay running until a test completes one: most tests read plans and records only.
      waitForOutcome: () => outcome,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    })
  }

  complete(index: number): void {
    this.#outcomes[index]?.({ status: "completed", finalResponse: "done" })
  }

  // Failure ceiling, not synchronization: the start signal is subscribed before it can fire.
  whenStarted(count: number): Promise<void> {
    if (this.specs.length >= count) return Promise.resolve()
    let ceiling: ReturnType<typeof setTimeout> | undefined
    const started = new Promise<void>((resolve) => this.#waiters.set(count, resolve))
    const timedOut = new Promise<void>((_resolve, reject) => {
      ceiling = setTimeout(() => reject(new Error(`child ${count} did not start within 5000ms`)), 5_000)
    })
    return Promise.race([started, timedOut]).finally(() => clearTimeout(ceiling))
  }
}

type Fixture = {
  readonly engine: TaskEngine
  readonly runtime: DagRuntime
  readonly runner: CapturingRunner
}

function compose(project: string, home: string): Fixture {
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const runner = new CapturingRunner()
  const pi = Object.assign(new FakeExtensionAPI(), { rpc: { emit: () => undefined, handle: () => undefined } })
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadSenpiOmoConfig({ cwd: project, env }).config,
    loadOmoConfig: () => loadSenpiOmoConfig({ cwd: project, env }),
    cwd: project,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  engine.runtime.captureFrom({
    mode: "tui",
    modelRegistry: createTeamServiceTestModelRegistry([MODEL_A, MODEL_B]),
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined },
    isIdle: () => false,
  })
  const createStore = spyOn(dagEngine, "createDagFileStore").mockImplementation((config, storeOptions = {}) =>
    createFileStore(config, { ...storeOptions, fsync: false }))
  try {
    const runtime = createDagRuntime({ pi, engine, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
    runtimes.push(runtime)
    return { engine, runtime, runner }
  } finally {
    createStore.mockRestore()
  }
}

async function startCategoryRun(runtime: DagRuntime, key: string): Promise<DagRunId> {
  const started = await runDagTool(
    {
      manager: runtime.manager,
      parentSessionId: () => sessionId,
      rootSessionId: () => sessionId,
      wait: runtime.wait,
      cancel: runtime.cancel,
      retry: runtime.retry,
      send: runtime.send,
      amend: runtime.amend,
    },
    { action: "start", definition: { key, name: key, nodes: [{ id: "work", prompt: "do work", category: "quick" }] } },
  )
  if (started.details.kind !== "started") throw new Error(`expected dag start, received ${started.details.kind}`)
  return started.details.run_id as DagRunId
}

function plannedRecord(fixture: Fixture, index: number) {
  const spec = fixture.runner.specs[index]
  if (spec === undefined) throw new Error(`child ${index} never started`)
  const record = fixture.engine.manager.get(spec.taskId)
  if (record === undefined) throw new Error(`no task record for ${spec.taskId}`)
  return { model: String(spec.model), requested: record.requested_model, generation: record.config_generation }
}

describe("workflow nodes plan on the live omo config (#11539)", () => {
  async function runBeforeAndAfterEdit(): Promise<Fixture> {
    const project = tempDir("omo-dag-category-config-")
    writeCategoryModel(project, MODEL_A)
    const fixture = compose(project, tempDir("omo-dag-category-home-"))
    await fixture.runtime.attach()
    await startCategoryRun(fixture.runtime, "before-edit")
    await fixture.runner.whenStarted(1)
    writeCategoryModel(project, MODEL_B)
    await startCategoryRun(fixture.runtime, "after-edit")
    await fixture.runner.whenStarted(2)
    return fixture
  }

  test("#given a workflow child running on category model A #when omo.json moves the category to model B and a new run starts #then its node plans on B and the running child keeps A", async () => {
    // given, when
    const fixture = await runBeforeAndAfterEdit()

    // then
    const before = plannedRecord(fixture, 0)
    const after = plannedRecord(fixture, 1)
    expect(after.model).toBe(MODEL_B)
    expect(after.requested).toMatchObject({ provider: "acme-b", model_id: "model-b", source: "category" })
    expect(before.model).toBe(MODEL_A)
    expect(before.requested).toMatchObject({ provider: "acme", model_id: "model-a", source: "category" })
  })

  test("#given a workflow child planned on generation 0 #when omo.json moves the category and a new run starts #then the new child record carries the next config generation", async () => {
    // given, when
    const fixture = await runBeforeAndAfterEdit()

    // then
    expect(plannedRecord(fixture, 0).generation).toBe(0)
    expect(plannedRecord(fixture, 1).generation).toBe(1)
  })

  type SeedNode = { readonly id: string; readonly dependsOn?: readonly string[] }

  async function seedPendingRun(project: string, runId: DagRunId, nodes: readonly SeedNode[] = [{ id: "resume" }]): Promise<void> {
    await createDagManager({
      store: createFileStore({ project_dir: project }, { fsync: false }),
      newRunId: () => runId,
    }).start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: {
        key: runId,
        name: runId,
        nodes: nodes.map((node) => ({
          id: node.id,
          prompt: `do ${node.id}`,
          category: "quick",
          ...(node.dependsOn === undefined ? {} : { dependsOn: [...node.dependsOn] }),
        })),
      },
    })
  }

  test("#given a pending workflow run on disk #when omo.json moves its category to model B before the session attaches #then the pending run loaded at attach plans on B", async () => {
    // given: the engine is composed at session start on model A, with a run a previous host left pending.
    const project = tempDir("omo-dag-category-pending-")
    writeCategoryModel(project, MODEL_A)
    const fixture = compose(project, tempDir("omo-dag-category-home-"))
    await seedPendingRun(project, "dag-category-pending" as DagRunId)

    // when
    writeCategoryModel(project, MODEL_B)
    await fixture.runtime.attach()
    await fixture.runner.whenStarted(1)

    // then
    expect(plannedRecord(fixture, 0).model).toBe(MODEL_B)
  })

  test("#given a two-node run paused by a host shutdown and resumed by the next host on model A #when omo.json moves the category to model B before the second node starts #then the resumed run plans that node on B", async () => {
    // given: the first host pauses the run on shutdown; its lease holder is gone when the next host starts.
    const project = tempDir("omo-dag-category-paused-")
    const home = tempDir("omo-dag-category-home-")
    writeCategoryModel(project, MODEL_A)
    const runId = "dag-category-paused" as DagRunId
    await seedPendingRun(project, runId, [{ id: "first" }, { id: "second", dependsOn: ["first"] }])
    const previousHost = compose(project, home)
    await previousHost.runtime.pauseForShutdown()
    previousHost.runtime.dispose()
    runtimes.splice(runtimes.indexOf(previousHost.runtime), 1)
    const store = createFileStore({ project_dir: project }, { fsync: false })
    const paused = store.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
    if (paused?.status !== "paused") throw new Error(`expected a paused checkpoint, got ${paused?.status}`)
    store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })
    const nextHost = compose(project, home)

    // when: recovery claims and resumes the run; attach returns once the resumed run settles.
    const attached = nextHost.runtime.attach()
    await nextHost.runner.whenStarted(1)
    writeCategoryModel(project, MODEL_B)
    nextHost.runner.complete(0)
    await nextHost.runner.whenStarted(2)
    nextHost.runner.complete(1)
    await attached

    // then
    expect(store.readEvents(runId, 0, { limit: 256 }).events.map((event) => event.type)).toContain("dag.run.resumed")
    expect(plannedRecord(nextHost, 0).model).toBe(MODEL_A)
    expect(plannedRecord(nextHost, 1).model).toBe(MODEL_B)
  })
})

