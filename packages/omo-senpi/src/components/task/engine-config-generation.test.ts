import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import * as senpiTask from "@oh-my-opencode/senpi-task"

import { checkReviveGeneration, type ReviveGenerationWarning } from "../../../../senpi-task/src/lifecycle/revive-policy"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function quickModel(model: string): OmoConfig {
  return { categories: { quick: { model } } }
}

describe("task engine config generation across a mid-session edit", () => {
  test("#given a category edit after the engine was composed #when a recorded task is revived #then the revival reads the live map and no config_generation_mismatch is raised", () => {
    // given an engine composed on one config whose live getter later returns an edited one
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-engine-config-generation-"))
    tempRoots.push(cwd)
    const snapshot = quickModel("example-a/model-a")
    let live = snapshot
    const revivePolicies: Array<senpiTask.LifecycleDeps["revivePolicy"]> = []
    const realCreateTaskLifecycle = senpiTask.createTaskLifecycle
    const lifecycleSpy = spyOn(senpiTask, "createTaskLifecycle").mockImplementation((deps) => {
      revivePolicies.push(deps.revivePolicy)
      return realCreateTaskLifecycle(deps)
    })
    const pi = new FakeExtensionAPI()
    let engine: ReturnType<typeof composeTaskEngine>
    try {
      engine = composeTaskEngine({ pi, omoConfig: snapshot, getOmoConfig: () => live, cwd, sharedParentTools: () => [] })
    } finally {
      lifecycleSpy.mockRestore()
    }
    engine.runtime.captureFrom({
      modelRegistry: createTeamServiceTestModelRegistry(["example-a/model-a", "example-b/model-b"]),
      sessionManager: { getSessionId: () => "parent-1" },
    })
    const spec = { prompt: "work", parent_session_id: "parent-1", depth: 0, category: "quick" }
    expect(engine.planner(spec).kind).toBe("resolved")
    live = quickModel("example-b/model-b")
    const edited = engine.planner(spec)
    const plannedGeneration = engine.categoryConfigGenerations.current()?.generation

    // when the lifecycle asks for the current generation to revive a task the edited map planned
    const policy = revivePolicies[0]
    const current = policy?.currentGeneration()
    const warnings: ReviveGenerationWarning[] = []
    const record = { ...senpiTask.createTaskRecord({ parent_session_id: "parent-1", root_session_id: "parent-1", depth: 0, execution_mode: "in-process", model: "example-b/model-b", notify_on_terminal: false }), config_generation: plannedGeneration }
    const admitted = policy === undefined ? false : checkReviveGeneration(record, { ...policy, warn: (warning) => warnings.push(warning) })

    // then the generation does not flip back to the register-time snapshot
    expect(edited.kind).toBe("resolved")
    if (edited.kind === "resolved") expect(edited.plan.model).toBe("example-b/model-b")
    expect(plannedGeneration).toBe(1)
    expect(current).toBe(1)
    expect(engine.categoryConfigGenerations.current()?.generation).toBe(1)
    expect(admitted).toBe(true)
    expect(warnings).toEqual([])
  })
})
