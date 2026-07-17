declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createDelegateTask } from "./tools"

function createHarness(ask: (input: unknown) => Promise<void>) {
  let launchCount = 0
  const manager = {
    launch: async () => {
      launchCount += 1
      return { id: "bg_permission", sessionId: "ses_child", status: "running" }
    },
    getTask: () => ({ id: "bg_permission", sessionId: "ses_child", status: "running" }),
  }
  const client = {
    app: {
      agents: async () => ({ data: [{ name: "Workflow Builder", mode: "subagent" }] }),
    },
    config: { get: async () => ({ data: { model: "anthropic/claude-sonnet-4-6" } }) },
    session: {
      messages: async () => ({ data: [] }),
    },
  }
  const task = createDelegateTask(unsafeTestValue({
    manager,
    client,
    directory: "/tmp/category-target-permission",
    userCategories: { quick: { model: "anthropic/claude-sonnet-4-6" } },
    agentOverrides: {
      "workflow-planner": { category_target_agent: "Workflow Builder" },
    },
    availableModelsOverride: new Set(["anthropic/claude-sonnet-4-6"]),
  }))
  const context = unsafeTestValue({
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "workflow-planner",
    abort: new AbortController().signal,
    ask,
  })

  return { task, context, launchCount: () => launchCount }
}

const args = {
  description: "Route category task",
  prompt: "Implement the change",
  category: "quick",
  run_in_background: true,
  load_skills: [],
}

describe("category target permission", () => {
  test("asks task permission for the resolved stack-local target", async () => {
    const requests: unknown[] = []
    const harness = createHarness(async (input) => { requests.push(input) })

    await harness.task.execute(args, harness.context)

    expect(requests).toEqual([{
      permission: "task",
      patterns: ["Workflow Builder"],
      always: ["*"],
      metadata: {
        description: "Route category task",
        subagent_type: "Workflow Builder",
      },
    }])
    expect(harness.launchCount()).toBe(1)
  })

  test("does not launch when resolved-target permission is denied", async () => {
    const harness = createHarness(async () => { throw new Error("permission denied") })

    await expect(harness.task.execute(args, harness.context)).rejects.toThrow("permission denied")

    expect(harness.launchCount()).toBe(0)
  })
})
