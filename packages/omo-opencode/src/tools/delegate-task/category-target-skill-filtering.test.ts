import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { createDelegateTask } from "./tools"

function makeRestrictedSkill(name: string, agent: string, template: string): LoadedSkill {
  return {
    name,
    path: `/tmp/${name}/SKILL.md`,
    definition: {
      name,
      description: `${agent} restricted skill`,
      agent,
      template,
    },
    scope: "config",
  }
}

function createHarness(skills: LoadedSkill[]) {
  let launchedAgent: string | undefined
  let launchedSkillContent: string | undefined
  const manager = {
    launch: async (input: { agent?: string; skillContent?: string }) => {
      launchedAgent = input.agent
      launchedSkillContent = input.skillContent
      return { id: "bg_skill_filter", sessionId: "ses_child", status: "running" }
    },
    getTask: () => ({ id: "bg_skill_filter", sessionId: "ses_child", status: "running" }),
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
    directory: "/tmp/category-target-skill-filtering",
    userCategories: { quick: { model: "anthropic/claude-sonnet-4-6" } },
    agentOverrides: {
      "workflow-planner": { category_target_agent: "Workflow Builder" },
    },
    availableModelsOverride: new Set(["anthropic/claude-sonnet-4-6"]),
    getLoadedSkills: async () => skills,
  }))
  const context = unsafeTestValue({
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "workflow-planner",
    abort: new AbortController().signal,
    ask: async () => {},
  })

  return {
    task,
    context,
    launchedAgent: () => launchedAgent,
    launchedSkillContent: () => launchedSkillContent,
  }
}

const baseArgs = {
  description: "Route category task",
  prompt: "Implement the change",
  category: "quick",
  run_in_background: true,
}

describe("category target skill filtering", () => {
  test("retains a skill restricted to the resolved stack-local target", async () => {
    const harness = createHarness([
      makeRestrictedSkill("workflow-builder-only", "Workflow Builder", "WORKFLOW_BUILDER_ONLY"),
    ])

    await harness.task.execute({ ...baseArgs, load_skills: ["workflow-builder-only"] }, harness.context)

    expect(harness.launchedAgent()).toBe("Workflow Builder")
    expect(harness.launchedSkillContent()).toContain("WORKFLOW_BUILDER_ONLY")
  })

  test("excludes a skill restricted to the category placeholder from the resolved target", async () => {
    const harness = createHarness([
      makeRestrictedSkill("junior-only", "Sisyphus-Junior", "SISYPHUS_JUNIOR_ONLY"),
    ])

    await harness.task.execute({ ...baseArgs, load_skills: ["junior-only"] }, harness.context)

    expect(harness.launchedAgent()).toBe("Workflow Builder")
    expect(harness.launchedSkillContent()).not.toContain("SISYPHUS_JUNIOR_ONLY")
  })
})
