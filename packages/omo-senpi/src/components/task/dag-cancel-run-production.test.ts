import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { cleanupProjects, FakeRunner, launchSettled } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import type { RunRef } from "../../../../senpi-task/src/pause/ports"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createDagRuntime } from "./dag-runtime"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

async function pausedWorkflow(fences: { readonly release?: (runRef: RunRef) => void }) {
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
      resumeTurn: async () => { throw new Error("a cancelled run never resumes") },
      holdInput: async () => { throw new Error("a cancelled run holds no input") },
    },
  })
  engine.runtime.captureFrom({
    modelRegistry: createTeamServiceTestModelRegistry(),
    sessionManager: { getSessionId: () => "parent-1" },
    ...(fences.release === undefined ? {} : { releaseRunFence: fences.release }),
  })
  const started = await engine.manager.start({
    prompt: "node b", parent_session_id: "parent-1", depth: 0, model: "omo-mock/mock-1", run_in_background: true,
  })
  if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
  await launchSettled(engine.manager, started.task_id)
  await engine.manager.pauseTask(started.task_id, {
    parentSessionId: "parent-1", parentPauseSeq: 7, runRef: { kind: "dag", id: h.runId },
  })
  h.store.writeCheckpoint(h.runId, {
    ...h.read(), nodes: h.read().nodes.map(node => node.id === h.b ? { ...node, taskId: started.task_id } : node),
  })
  const runtime = createDagRuntime({ pi, engine, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
  const dispose = async () => {
    runtime.dispose()
    engine.manager.workpools?.dispose()
    await h.manager.cancelTask(h.taskId)
  }
  return { h, engine, runtime, childTaskId: started.task_id, dispose }
}

test("design 27: cancelling a user-paused workflow ends every paused child, journals the run cancelled, then releases its run fence once", async () => {
  const releases: { readonly runRef: RunRef; readonly runStatus: string | undefined }[] = []
  let read: (() => { readonly status: string }) | undefined
  const w = await pausedWorkflow({ release: runRef => { releases.push({ runRef, runStatus: read?.().status }) } })
  read = w.h.read
  try {
    await w.runtime.cancel(w.h.runId)
    expect(w.engine.manager.get(w.childTaskId)?.status).toBe("cancelled")
    expect(w.engine.manager.getResidentHandle(w.childTaskId)).toBeUndefined()
    const record = w.h.read()
    expect(record.status).toBe("cancelled")
    expect(record.nodes.find(node => node.id === "a")?.state).toBe("completed")
    expect(record.nodes.filter(node => node.id !== "a").map(node => node.state)).toEqual(["cancelled", "cancelled"])
    expect(releases).toEqual([{ runRef: { kind: "dag", id: w.h.runId }, runStatus: "cancelled" }])
  } finally { await w.dispose() }
}, 15_000)

test("design 27: without the engine's fence release the workflow is still cancelled and its paused children ended", async () => {
  const w = await pausedWorkflow({})
  try {
    await w.runtime.cancel(w.h.runId)
    expect(w.engine.manager.get(w.childTaskId)?.status).toBe("cancelled")
    expect(w.engine.manager.getResidentHandle(w.childTaskId)).toBeUndefined()
    expect(w.h.read().status).toBe("cancelled")
  } finally { await w.dispose() }
}, 15_000)
