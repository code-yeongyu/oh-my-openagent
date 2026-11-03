import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createTaskRecordStore,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
} from "@oh-my-opencode/senpi-task"

import { buildRespawnManagedSpec } from "../../../../senpi-task/src/manager/manager-helpers"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createTeamService } from "./team-service"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function handle(spec: ManagedStartSpec): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    sessionId: `session-${spec.taskId}`,
    pid: undefined,
    steer: async () => {},
    followUp: async () => {},
    abort: async () => {},
    subscribe: () => () => {},
    waitForOutcome: () => new Promise<RunnerOutcome>(() => {}),
    lastAssistantText: () => undefined,
    dispose: async () => {},
  }
}

test.each(["root", "in-process", "hosted"] as const)(
  "#given a %s lead #when it creates a team #then member records and respawn retain the tree ancestry",
  async (kind) => {
    // given the real composed manager, with only child execution replaced
    const cwd = mkdtempSync(join(tmpdir(), "team-root-"))
    roots.push(cwd)
    const stateDir = join(cwd, "tasks")
    const pi = new FakeExtensionAPI()
    if (kind === "hosted") {
      Object.defineProperty(pi, "sessionContext", {
        value: { role: "child", depth: "4", root_session_id: "tree-root" },
      })
    }
    const launches: ManagedStartSpec[] = []
    const runner: ManagedRunner = {
      start: async (spec) => {
        launches.push(spec)
        return handle(spec)
      },
    }
    const omoConfig = {
      task: OmoTaskSettingsSchema.parse({ state_dir: stateDir, max_depth: 6, default_concurrency: 4 }),
      categories: { quick: { model: "omo-mock/mock-1" } },
    }
    const engine = composeTaskEngine({
      pi, omoConfig, cwd, env: {}, sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    const modelRegistry = createTeamServiceTestModelRegistry()
    let leadSessionId = kind === "hosted" ? "hosted-lead" : "tree-root"
    engine.runtime.captureFrom({ modelRegistry, sessionManager: { getSessionId: () => leadSessionId } })
    if (kind === "in-process") {
      const child = await engine.manager.start({
        prompt: "Lead a team", category: "quick", execution_mode: "in-process",
        parent_session_id: "tree-root", root_session_id: "tree-root", depth: 1, run_in_background: true,
      })
      if (child.kind !== "started") throw new Error(`lead did not start: ${child.kind}`)
      leadSessionId = `session-${child.task_id}`
      engine.runtime.captureFrom({ modelRegistry, sessionManager: { getSessionId: () => leadSessionId } })
    }
    const service = createTeamService({
      manager: engine.manager,
      destruction: engine.lifecycle,
      runtime: engine.runtime,
      settings: engine.settings,
      omoConfig, cwd,
      agentNames: new Set(Object.keys(engine.agents)),
      resolveAncestry: engine.resolveAncestry,
    })
    try {
      // when a lead already below the root (or the root itself) creates multiple members
      const created = await service.createTeam({
        inlineSpec: {
          name: "ancestry",
          members: ["alpha", "beta"].map((name) => ({ name, kind: "category", category: "quick" })),
        },
      })
      const depth = kind === "root" ? 1 : kind === "hosted" ? 5 : 2
      const store = createTaskRecordStore({ project_dir: cwd, task: { state_dir: stateDir } })
      expect(Object.values(created.memberTaskIds)).toHaveLength(2)
      for (const taskId of Object.values(created.memberTaskIds)) {
        // then both disk and launch records retain the immediate parent and the original root
        const record = store.load(taskId)
        expect(record).toMatchObject({
          parent_session_id: leadSessionId, root_session_id: "tree-root", depth,
        })
        expect(launches.find((spec) => spec.taskId === taskId)).toMatchObject({
          parentSessionId: leadSessionId, rootSessionId: "tree-root", depth,
        })
        if (record === null) throw new Error("member record missing")
        expect(buildRespawnManagedSpec(record, stateDir)).toMatchObject({
          ok: true,
          spec: { parentSessionId: leadSessionId, rootSessionId: "tree-root", depth },
        })
      }
    } finally {
      for (const parentSessionId of new Set(["tree-root", leadSessionId])) {
        await engine.lifecycle.suspendOnSessionShutdown({ parentSessionId, reason: "quit" })
      }
    }
  },
)
