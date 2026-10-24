import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedChildHandle, ManagedStartSpec } from "@oh-my-opencode/senpi-task"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"
import { cleanupProjects, FakeRunner, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { deliverItems } from "../../extension/deliver-items"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

class CountingRunner extends FakeRunner {
  readonly #waiters: { readonly count: number; readonly resolve: () => void }[] = []

  // FakeRunner re-arms its outcome on every settle, so a manager that calls waitForOutcome() after the
  // test settled the child would wait forever; each launch here keeps the outcome it started with.
  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    const outcome = handle.waitForOutcome()
    for (const waiter of this.#waiters.filter(entry => this.startedSpecs.length >= entry.count)) waiter.resolve()
    return { ...handle, waitForOutcome: () => outcome }
  }

  whenStarted(count: number): Promise<void> {
    return this.startedSpecs.length >= count ? Promise.resolve() : new Promise(resolve => { this.#waiters.push({ count, resolve }) })
  }
}

const settled = () => new Promise<void>(resolve => setImmediate(resolve))

test("design 18: Stop on A-done, B-running, C-queued keeps A, holds B's child without settling it, never launches C and wakes no parent turn", async () => {
  const cwd = tempProject()
  const runner = new CountingRunner()
  const pi = new FakeExtensionAPI()
  const fenced = new Set<string>()
  const admitted: { readonly content: string; readonly disposition: "notice_persisted" | "message_persisted" }[] = []
  const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((_native, delivery) => delivery.items.map((item, index) => {
    const disposition = item.runRef !== undefined && fenced.has(`${item.runRef.kind}:${item.runRef.id}`) ? "notice_persisted" as const : "message_persisted" as const
    admitted.push({ content: options.items[index]?.content ?? "", disposition })
    return disposition === "notice_persisted"
      ? { itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition }
      : { itemId: item.itemId, entryId: `entry:${item.itemId}`, disposition }
  }), { ...options, message }))
  let pauseState: EnginePauseState = { pauseSeq: 6, holds: [] }
  const engine = composeTaskEngine({
    pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [], coordinator,
    runnerFactories: { inProcess: () => runner, process: () => runner },
    childPausePort: {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 3 }
      },
      resumeTurn: async () => { throw new Error("the run was not resumed") },
      holdInput: async () => { throw new Error("no input was held") },
    },
  })
  engine.runtime.captureFrom({
    modelRegistry: createTeamServiceTestModelRegistry(), isIdle: () => true,
    sessionManager: { getSessionId: () => "parent-1" },
    getPauseState: () => pauseState, fenceRun: ref => { fenced.add(`${ref.kind}:${ref.id}`) },
  })
  const runtime = createDagRuntime({ pi, engine, coordinator, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
  await runtime.attach()
  try {
    const started = await runtime.manager.start({
      parentSessionId: "parent-1", rootSessionId: "parent-1",
      definition: {
        key: "stop-three-nodes", name: "stop three nodes",
        nodes: [
          { id: "a", prompt: "a", subagent_type: "explore", model: "omo-mock/mock-1" },
          { id: "b", prompt: "b", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: ["a"] },
          { id: "c", prompt: "c", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: ["b"] },
        ],
      },
    })
    const runId = started.snapshot.runId as DagRunId
    await runner.whenStarted(1)
    const aTask = runner.startedSpecs[0]?.taskId ?? ""
    runner.handles.get(aTask)?.settle({ status: "completed", finalResponse: "a output" })
    await runner.whenStarted(2)
    const bTask = runner.startedSpecs[1]?.taskId ?? ""
    await settled()
    const admittedBeforeStop = admitted.length

    pauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
    await engine.runPause?.bridge.changed("parent-1", { ...pauseState, change: "paused" })
    await settled()

    const record = runtime.manager.record(runId, "parent-1")
    expect(record.status).toBe("paused")
    expect(record.pause).toEqual({ reason: "user_stop", pauseSeq: 7 })
    expect(record.nodes.find(node => node.id === "a")).toMatchObject({ state: "completed", output: "a output" })
    expect(record.nodes.find(node => node.id === "b")).toMatchObject({ state: "paused", taskId: bTask })
    expect(record.nodes.find(node => node.id === "c")?.taskId).toBeUndefined()
    expect(engine.manager.get(bTask)?.status).toBe("paused")
    expect(runner.startedSpecs).toHaveLength(2)
    expect(engine.runPause?.registry.require("parent-1").phase).toBe("applied")
    const afterStop = admitted.slice(admittedBeforeStop)
    expect(afterStop.filter(entry => entry.disposition === "message_persisted")).toEqual([])
    expect(afterStop).toEqual([{ content: expect.stringContaining("paused by your Stop"), disposition: "notice_persisted" }])
  } finally {
    for (const { record } of engine.manager.list({ scope: "all" })) await engine.manager.cancelTask(record.task_id)
    runtime.dispose()
    engine.manager.workpools?.dispose()
  }
}, 15_000)
