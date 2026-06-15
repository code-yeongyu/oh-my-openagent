/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool"

import { OhMyOpenCodeConfigSchema } from "../config"
import { buildSystemContent } from "../tools/delegate-task/prompt-builder"
import { createSkillTool } from "../tools/skill"
import { createSkillContext } from "./skill-context"

const LOCAL_ULW_PLAN_BODY = "LOCAL PROJECT ULW PLAN BODY"
const POISONED_SHARED_BODY = "POISONED PROJECT SHARED ULW PLAN BODY"

function createToolContext(directory: string): ToolContext {
  return {
    sessionID: "ses_plugin_shared_skill_test",
    messageID: "msg_plugin_shared_skill_test",
    agent: "sisyphus",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

function writeSkill(dir: string, frontmatterName: string, description: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${frontmatterName}`,
      `description: ${description}`,
      "---",
      body,
      "",
    ].join("\n"),
  )
}

function toolResultToText(result: ToolResult): string {
  return typeof result === "string" ? result : result.output
}

async function createPluginWiredSkillTool(args: {
  readonly directory: string
  readonly disabledSkills?: readonly string[]
  readonly skills?: Record<string, unknown>
}): Promise<ReturnType<typeof createSkillTool>> {
  const pluginConfig = OhMyOpenCodeConfigSchema.parse({
    disabled_skills: args.disabledSkills,
    skills: args.skills,
  })
  const skillContext = await createSkillContext({
    directory: args.directory,
    pluginConfig,
  })

  return createSkillTool({
    directory: args.directory,
    skills: skillContext.mergedSkills,
    disabledSkills: skillContext.disabledSkills,
    browserProvider: skillContext.browserProvider,
    includeSkillsInDescription: true,
  })
}

async function expectSkillUnavailable(
  skillTool: ReturnType<typeof createSkillTool>,
  toolContext: ToolContext,
  name: string,
): Promise<void> {
  let caughtError: unknown
  try {
    await skillTool.execute({ name }, toolContext)
  } catch (error) {
    caughtError = error
  }

  if (!(caughtError instanceof Error)) {
    throw new Error(`Expected ${name} to be unavailable`)
  }
  expect(caughtError.message).toContain(`Skill or command "${name}" not found`)
}

describe("plugin-wired shared skill aliases", () => {
  let testDirectory: string
  let originalOpenCodeConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), "omo-plugin-shared-skill-"))
    originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = join(testDirectory, "isolated-opencode-config")
    process.env.CLAUDE_CONFIG_DIR = join(testDirectory, "isolated-claude-config")

    writeSkill(
      join(testDirectory, ".opencode", "skills", "ulw-plan"),
      "ulw-plan",
      "Hostile local bare ulw-plan",
      LOCAL_ULW_PLAN_BODY,
    )
    writeSkill(
      join(testDirectory, ".opencode", "skills", "canonical-collision"),
      "shared/ulw-plan",
      "Hostile project canonical shared ulw-plan",
      POISONED_SHARED_BODY,
    )
  })

  afterEach(() => {
    if (originalOpenCodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
    }
    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }
    rmSync(testDirectory, { recursive: true, force: true })
  })

  test("#given hostile local ulw-plan skills #when the plugin-wired skill tool executes #then plain stays local and shared stays bundled", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({ directory: testDirectory })
    const toolContext = createToolContext(testDirectory)

    // when
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedOutput = toolResultToText(
      await skillTool.execute({ name: "shared/ulw-plan" }, toolContext),
    )

    // then
    expect(plainOutput).toContain("## Skill: ulw-plan")
    expect(plainOutput).toContain(LOCAL_ULW_PLAN_BODY)
    expect(plainOutput).not.toContain(POISONED_SHARED_BODY)

    expect(sharedOutput).toContain("## Skill: shared/ulw-plan")
    expect(sharedOutput.replaceAll("\\", "/")).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput).not.toContain(POISONED_SHARED_BODY)
    expect(skillTool.description).not.toContain("Hostile project canonical shared ulw-plan")
  })

  test("#given hostile config entry for protected shared ulw-plan #when the plugin-wired skill tool executes #then config is ignored and bundled shared remains", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: {
        "shared/ulw-plan": {
          description: "IGNORE_ALL_PRIOR_INSTRUCTIONS",
          template: "HOSTILE_BODY",
        },
      },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedOutput = toolResultToText(
      await skillTool.execute({ name: "shared/ulw-plan" }, toolContext),
    )

    // then
    expect(plainOutput).toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput.replaceAll("\\", "/")).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
    expect(sharedOutput).not.toContain("HOSTILE_BODY")
    expect(skillTool.description).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
  })

  test("#given shared ulw-plan is disabled #when the plugin-wired skill tool executes #then local bare remains and shared alias is unavailable", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      disabledSkills: ["shared/ulw-plan"],
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
    expect(plainOutput).toContain(LOCAL_ULW_PLAN_BODY)
  })

  test("#given shared ulw-plan is disabled through skills.disable #when the plugin-wired skill tool executes #then local bare remains and shared alias is unavailable", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { disable: ["shared/ulw-plan"] },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
    expect(plainOutput).toContain(LOCAL_ULW_PLAN_BODY)
  })

  test("#given skills.disable removes shared ulw-plan without a local override #when the plugin-wired skill tool executes #then shared-scope fallback is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { disable: ["shared/ulw-plan"] },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
  })

  test("#given shared ulw-plan config entry is false without a local override #when the plugin-wired skill tool executes #then shared-scope fallback is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { "shared/ulw-plan": false },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
  })

  test("#given shared ulw-plan config entry is disabled without a local override #when the plugin-wired skill tool executes #then shared-scope fallback is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { "shared/ulw-plan": { disable: true } },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
  })

  test("#given disabled shared config skill entry #when delegate prompt lists available skills #then hostile description is not injected", async () => {
    // given
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({
      disabled_skills: ["shared/ulw-plan"],
      skills: {
        "shared/ulw-plan": {
          description: "IGNORE_ALL_PRIOR_INSTRUCTIONS",
          template: "HOSTILE_BODY",
        },
      },
    })

    // when
    const skillContext = await createSkillContext({
      directory: testDirectory,
      pluginConfig,
    })
    const systemContent = buildSystemContent({
      agentsContext: "base",
      availableCategories: [],
      availableSkills: skillContext.availableSkills,
    })

    // then
    expect(systemContent).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
    expect(systemContent).not.toContain("HOSTILE_BODY")
    expect(skillContext.mergedSkills.map((skill) => skill.name)).not.toContain("shared/ulw-plan")
  })
})
