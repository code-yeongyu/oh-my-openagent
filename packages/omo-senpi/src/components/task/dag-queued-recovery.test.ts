import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import { cleanupProjects, FakeRunner, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { deliverItems } from "../../extension/deliver-items"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

const PARENT = "parent-1"
const WAVE_ONE = Array.from({ length: 12 }, (_, index) => `w1-${index}`)
const DEFINITION = {
  key: "queued-recovery", name: "queued recovery",
  nodes: [
    ...WAVE_ONE.map(id => ({ id, prompt: id, subagent_type: "explore", model: "omo-mock/mock-1" })),
    { id: "merge", prompt: "merge", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: WAVE_ONE },
  ],
}

const drained = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise<void>(resolve => setImmediate(resolve)) }

function compose(cwd: string) {
  const runner = new FakeRunner()
  const pi = new FakeExtensionAPI()
  const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((_native, delivery) => delivery.items.map(item =>
    ({ itemId: item.itemId, entryId: `entry:${item.itemId}`, disposition: "message_persisted" as const })), { ...options, message }))
  const state: { pause: EnginePauseState } = { pause: { pauseSeq: 6, holds: [] } }
  const config = loadOmoConfig({ cwd }).config
  const engine = composeTaskEngine({
    pi, cwd, omoConfig: { ...config, task: OmoTaskSettingsSchema.parse({ ...config.task, default_concurrency: 3 }) }, sharedParentTools: () => [], coordinator,
    runnerFactories: { inProcess: () => runner, process: () => runner },
    childPausePort: {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 3 }
      },
      resumeTurn: async child => ({ turnId: "resumed-turn", outcome: child.waitForOutcome() }),
      holdInput: async () => { throw new Error("no input was held") },
    },
  })
  engine.runtime.captureFrom({
    modelRegistry: createTeamServiceTestModelRegistry(), isIdle: () => true,
    sessionManager: { getSessionId: () => PARENT },
    getPauseState: () => state.pause, fenceRun: () => undefined, releaseRunFence: () => undefined,
  })
  const runtime = createDagRuntime({ pi, engine, coordinator, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
  const dispose = async () => {
    for (const { record } of engine.manager.list({ scope: "all" })) await engine.manager.cancelTask(record.task_id)
    runtime.dispose()
    engine.manager.workpools?.dispose()
  }
  return { runner, engine, runtime, state, dispose }
}

async function startWithQueue(world: ReturnType<typeof compose>): Promise<DagRunId> {
  await world.runtime.attach()
  const started = await world.runtime.manager.start({ parentSessionId: PARENT, rootSessionId: PARENT, definition: DEFINITION })
  await drained()
  expect(world.runner.startedSpecs).toHaveLength(3)
  expect(world.engine.manager.list({ scope: "all" }).filter(({ record }) => record.status === "pending")).toHaveLength(9)
  return started.snapshot.runId as DagRunId
}

async function completeRunningChildren(world: ReturnType<typeof compose>): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    const running = world.engine.manager.list({ scope: "all" }).filter(({ record }) => record.status === "running")
    if (running.length === 0) return
    for (const { record } of running) world.runner.handles.get(record.task_id)?.settle({ status: "completed", finalResponse: `${record.task_id} done` })
    await drained()
  }
}

test("#given wave-one nodes queued behind the concurrency cap #when the user Stops and then Resumes #then every queued node and the merge node still run and the run completes", async () => {
  const world = compose(tempProject())
  try {
    const runId = await startWithQueue(world)

    world.state.pause = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
    await world.engine.runPause?.bridge.changed(PARENT, { ...world.state.pause, change: "paused" })
    world.state.pause = { pauseSeq: 7, holds: [] }
    await world.engine.runPause?.bridge.changed(PARENT, { ...world.state.pause, change: "resumed" })
    await drained()
    await completeRunningChildren(world)

    const record = world.runtime.manager.record(runId, PARENT)
    expect(record.nodes.filter(node => node.error?.code === "resume_task_orphaned")).toEqual([])
    expect(record.nodes).toHaveLength(WAVE_ONE.length + 1)
    expect(record.nodes.filter(node => node.state !== "completed").map(node => `${node.id}:${node.state}`)).toEqual([])
    expect(record.status).toBe("completed")
    expect(world.engine.manager.list({ scope: "all" }).filter(({ record: task }) => task.status === "pending")).toEqual([])
  } finally { await world.dispose() }
}, 15_000)

test("#given wave-one nodes queued behind the concurrency cap #when the session quits and is reopened #then the queued nodes are re-admitted instead of failing as orphaned", async () => {
  const cwd = tempProject()
  const before = compose(cwd)
  const runId = await startWithQueue(before)
  await before.runtime.pauseForShutdown()
  before.runtime.detach()
  await before.engine.lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT, reason: "quit" })
  before.runtime.dispose()
  const store = createDagFileStore({ project_dir: cwd }, { fsync: false })
  const paused = store.readCheckpoint<Record<string, unknown>>(runId)
  if (paused === null) throw new Error("expected the quit to leave a paused checkpoint")
  store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })

  const after = compose(cwd)
  try {
    await after.engine.lifecycle.reconcileOnSessionStart(PARENT)
    void after.runtime.attach()
    await drained()

    const record = after.runtime.manager.record(runId, PARENT)
    expect(record.nodes.filter(node => node.error?.code === "resume_task_orphaned")).toEqual([])
    const strandedPending = after.engine.manager.list({ scope: "all" })
      .filter(entry => entry.record.status === "pending" && entry.queue_position === undefined)
    expect(strandedPending).toEqual([])
  } finally { await after.dispose() }
}, 15_000)
