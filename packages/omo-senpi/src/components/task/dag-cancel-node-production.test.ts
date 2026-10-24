import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { cleanupProjects, FakeRunner, launchSettled } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createDagRuntime } from "./dag-runtime"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

test("design 26: production workflow cancel_node ends the paused node's child and cancels only that node", async () => {
  const h = await pausedRun()
  const runner = new FakeRunner()
  const pi = new FakeExtensionAPI()
  const engine = composeTaskEngine({
    pi, cwd: h.project, omoConfig: loadOmoConfig({ cwd: h.project }).config,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
    childPausePort: {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 3 }
      },
      resumeTurn: async () => { throw new Error("cancel_node must not resume the child") },
      holdInput: async () => { throw new Error("cancel_node holds no input") },
    },
  })
  engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry(), sessionManager: { getSessionId: () => "parent-1" } })
  const started = await engine.manager.start({
    prompt: "node b", parent_session_id: "parent-1", depth: 0, model: "omo-mock/mock-1", run_in_background: true,
  })
  if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
  let runtime: ReturnType<typeof createDagRuntime> | undefined
  try {
    await launchSettled(engine.manager, started.task_id)
    await engine.manager.pauseTask(started.task_id, {
      parentSessionId: "parent-1", parentPauseSeq: 7, runRef: { kind: "dag", id: h.runId },
    })
    h.store.writeCheckpoint(h.runId, {
      ...h.read(), nodes: h.read().nodes.map(node => node.id === h.b ? { ...node, taskId: started.task_id } : node),
    })
    runtime = createDagRuntime({ pi, engine, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
    await expect(runtime.cancelNode(h.runId, h.b)).resolves.toBeUndefined()
    expect(h.read().nodes.find(node => node.id === h.b)?.state).toBe("cancelled")
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("blocked")
    expect(h.read().status).toBe("paused")
    expect(engine.manager.get(started.task_id)?.status).toBe("cancelled")
    expect(engine.manager.getResidentHandle(started.task_id)).toBeUndefined()
  } finally {
    runtime?.dispose()
    engine.manager.workpools?.dispose()
    await h.manager.cancelTask(h.taskId)
  }
}, 15_000)
