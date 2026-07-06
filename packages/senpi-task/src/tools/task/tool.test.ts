import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { TaskManager } from "../../manager"
import { TASK_TOOL_NAME, createTaskTool } from "./tool"
import type { TaskToolDeps } from "./types"

const OMO_CONFIG: OmoConfig = {
  categories: { "release-crew": { description: "Ships the release train" } },
  agents: {},
}

function notImplemented(name: string): never {
  throw new Error(`fake TaskManager.${name} not configured`)
}

function fakeManager(overrides: Partial<TaskManager>): TaskManager {
  return {
    start: () => notImplemented("start"),
    continueTask: () => notImplemented("continueTask"),
    sendToTask: () => notImplemented("sendToTask"),
    interruptTask: () => notImplemented("interruptTask"),
    cancelTask: () => notImplemented("cancelTask"),
    get: () => undefined,
    list: () => [],
    waitFor: () => notImplemented("waitFor"),
    ...overrides,
  }
}

function deps(manager: TaskManager): TaskToolDeps {
  return { manager, omoConfig: OMO_CONFIG, agents: { oracle: { name: "oracle", description: "Deep reasoning" } } }
}

describe("createTaskTool", () => {
  test("#given deps #when the tool is created #then it exposes the senpi ToolDefinition surface", () => {
    // given
    const tool = createTaskTool(deps(fakeManager({})))

    // then
    expect(tool.name).toBe(TASK_TOOL_NAME)
    expect(tool.label.length).toBeGreaterThan(0)
    expect(tool.parameters.type).toBe("object")
    expect(typeof tool.execute).toBe("function")
    expect(tool.promptSnippet).toBeTruthy()
    expect(Array.isArray(tool.promptGuidelines)).toBe(true)
    expect(typeof tool.renderCall).toBe("function")
    expect(typeof tool.renderResult).toBe("function")
  })

  test("#given a custom omo.json category #when the description is read #then it lists that category (dynamic snapshot)", () => {
    // given
    const tool = createTaskTool(deps(fakeManager({})))

    // then
    expect(tool.description).toContain("release-crew")
    expect(tool.description).toContain("Ships the release train")
    expect(tool.description).toContain("oracle")
  })

  test("#given the assembled tool #when parameters are read #then the shared TypeBox schema requires only prompt", () => {
    // given
    const tool = createTaskTool(deps(fakeManager({})))

    // then
    expect(tool.parameters.required).toEqual(["prompt"])
  })
})
