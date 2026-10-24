import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { cleanupProjects, FakeRunner, launchSettled } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { applyPausedDagGuidance } from "../../../../senpi-task/src/dag/paused-controls"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import type { RunPauseSource } from "./engine-run-pause"
import { createDagRuntime } from "./dag-runtime"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

test("production DAG dispatch transfers only the final journal revision into child custody", async () => {
  const h = await pausedRun()
  const runner = new FakeRunner()
  const delivered: { inputId: string; revision: number; text: string }[] = []
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
      resumeTurn: async () => { throw new Error("dispatch must not resume the child") },
      holdInput: async (_child, input) => {
        expect(h.read().guidance?.find(entry => entry.id === input.inputId)?.state).toBe("dispatching")
        delivered.push(input)
        return { kind: "held", entryId: "native-held-1", duplicate: false }
      },
    },
  })
  engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry() })
  const started = await engine.manager.start({
    prompt: "await guidance", parent_session_id: "parent-1", depth: 0,
    model: "omo-mock/mock-1", run_in_background: true,
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
    const guide = (command: Parameters<typeof applyPausedDagGuidance>[2]) =>
      applyPausedDagGuidance({ ...h.options, initialRecord: h.read() }, h.runId, command)
    const retained = guide({ kind: "add", nodeId: h.b, text: "first draft" })
    guide({ kind: "edit", id: retained.id, text: "final guidance" })
    const removed = guide({ kind: "add", nodeId: h.b, text: "withdraw this draft" })
    guide({ kind: "remove", id: removed.id })
    expect(delivered).toEqual([])

    const graph = engine.runPause
    if (graph === undefined) throw new Error("production run pause graph is missing")
    let source: RunPauseSource | undefined
    runtime = createDagRuntime({
      pi, engine: {
        ...engine,
        runPause: { ...graph, register: candidate => {
          source = candidate
          return graph.register(candidate)
        } },
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })
    if (source?.dispatchGuidance === undefined) throw new Error("production DAG source is missing")
    await expect(source.dispatchGuidance("parent-1", 7, "resume-1")).resolves.toBeUndefined()
    expect(delivered).toEqual([{ inputId: retained.id, revision: 1, text: "final guidance" }])
    expect(h.read().guidance?.find(entry => entry.id === retained.id)).toMatchObject({
      state: "delivered", deliveries: [{ taskId: started.task_id, entryId: "native-held-1" }],
    })
    await source.dispatchGuidance("parent-1", 7, "resume-1")
    expect(delivered).toHaveLength(1)
    expect(h.read().status).toBe("paused")
  } finally {
    runtime?.dispose()
    await engine.manager.cancelTask(started.task_id)
    engine.manager.workpools?.dispose()
    await h.manager.cancelTask(h.taskId)
  }
}, 15_000)
