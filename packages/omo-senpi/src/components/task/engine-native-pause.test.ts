import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedRunner } from "@oh-my-opencode/senpi-task"
import { cleanupProjects, makeHandle, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { RunPauseOwner } from "../../../../senpi-task/src/pause/ports"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

afterEach(cleanupProjects)

for (const mode of ["in-process", "process"] as const) {
  test(`${mode}: production composition pauses through native child controls without an injected pause port`, async () => {
    const cwd = tempProject()
    const calls: RunPauseOwner[] = []
    const subscribed = Promise.withResolvers<void>()
    const runner: ManagedRunner = {
      start: async spec => {
        const fake = makeHandle(spec.taskId)
        void fake.waitForSubscription().then(() => subscribed.resolve())
        return {
          ...fake.handle,
          runPause: {
            pauseForRun: async (owner: RunPauseOwner) => {
              calls.push(owner)
              fake.settle({ status: "cancelled" })
              return { childSeq: 3 }
            },
            resumeForRun: async () => ({ released: false as const, reason: "not_held" as const }),
            holdInput: async () => ({ kind: "held" as const, entryId: "held-1", duplicate: false }),
          },
        }
      },
    }
    const engine = composeTaskEngine({
      pi: new FakeExtensionAPI(), cwd, omoConfig: loadOmoConfig({ cwd }).config,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry() })
    const started = await engine.manager.start({
      prompt: "pause the native child", parent_session_id: "parent",
      depth: 0, execution_mode: mode, model: "omo-mock/mock-1", run_in_background: true,
    })
    if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
    const owner: RunPauseOwner = {
      parentSessionId: "parent", parentPauseSeq: 2, runRef: { kind: "task", id: started.task_id },
    }
    try {
      await subscribed.promise
      await expect(engine.manager.pauseTask(started.task_id, owner)).resolves.toEqual({ childSeq: 3 })
      expect(calls).toEqual([owner])
      expect(engine.manager.get(started.task_id)?.status).toBe("paused")
    } finally {
      await engine.manager.cancelTask(started.task_id)
      engine.manager.workpools?.dispose()
    }
  }, 10_000)
}
