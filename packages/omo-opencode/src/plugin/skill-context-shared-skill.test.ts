/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool"

import { OhMyOpenCodeConfigSchema } from "../config"
import { buildSystemContent } from "../tools/delegate-task/prompt-builder"
import { resolveSkillContent } from "../tools/delegate-task/skill-resolver"
import { createSkillTool } from "../tools/skill"
import type { SkillLoadOptions } from "../tools/skill/types"
import { createSkillContext } from "./skill-context"

const LOCAL_ULW_PLAN_BODY = "LOCAL PROJECT ULW PLAN BODY"
const LOCAL_INLINE_ULW_PLAN_BODY = "LOCAL_INLINE_ULW_PLAN_BODY"
const POISONED_SHARED_BODY = "POISONED PROJECT SHARED ULW PLAN BODY"
const POISONED_MIXED_CASE_SHARED_BODY = "POISONED MIXED CASE PROJECT SHARED ULW PLAN BODY"
const BLOCKED_MIXED_CASE_SKILL_BODY = "BLOCKED_MIXED_CASE_SKILL_BODY"
const BLOCKED_MIXED_CASE_SKILL_DESCRIPTION = "BLOCKED_MIXED_CASE_SKILL_DESCRIPTION"
const BLOCKED_NATIVE_SKILL_BODY = "BLOCKED_NATIVE_SKILL_BODY"
const BLOCKED_NATIVE_SKILL_DESCRIPTION = "BLOCKED_NATIVE_SKILL_DESCRIPTION"

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

function toPosixPath(text: string): string {
  return text.split("\\").join("/")
}

function createNativeSkills(
  directory: string,
  skills: Awaited<ReturnType<NonNullable<SkillLoadOptions["nativeSkills"]>["all"]>>,
): NonNullable<SkillLoadOptions["nativeSkills"]> {
  return {
    all() {
      return skills
    },
    get(name: string) {
      return skills.find((skill) => skill.name === name)
    },
    dirs() {
      return [join(directory, "native-skills")]
    },
  }
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

async function expectMixedCaseBlockedSkillFiltered(args: {
  readonly directory: string
  readonly disabledSkills?: readonly string[]
  readonly skills?: Record<string, unknown>
}): Promise<void> {
  writeSkill(
    join(args.directory, ".opencode", "skills", "blocked-skill"),
    "Blocked-Skill",
    BLOCKED_MIXED_CASE_SKILL_DESCRIPTION,
    BLOCKED_MIXED_CASE_SKILL_BODY,
  )
  const pluginConfig = OhMyOpenCodeConfigSchema.parse({
    disabled_skills: args.disabledSkills,
    skills: args.skills,
  })

  const skillContext = await createSkillContext({
    directory: args.directory,
    pluginConfig,
  })
  const systemContent = buildSystemContent({
    agentsContext: "base",
    availableCategories: [],
    availableSkills: skillContext.availableSkills,
  })
  const skillTool = createSkillTool({
    directory: args.directory,
    skills: skillContext.mergedSkills,
    disabledSkills: skillContext.disabledSkills,
    browserProvider: skillContext.browserProvider,
    includeSkillsInDescription: true,
  })

  expect(skillContext.mergedSkills.map((skill) => skill.name)).not.toContain("Blocked-Skill")
  expect(skillContext.availableSkills.map((skill) => skill.name)).not.toContain("Blocked-Skill")
  expect(systemContent).not.toContain(BLOCKED_MIXED_CASE_SKILL_DESCRIPTION)
  expect(systemContent).not.toContain(BLOCKED_MIXED_CASE_SKILL_BODY)
  expect(skillTool.description).not.toContain(BLOCKED_MIXED_CASE_SKILL_DESCRIPTION)
  const resolved = await resolveSkillContent(["Blocked-Skill"], {
    directory: args.directory,
    disabledSkills: skillContext.disabledSkills,
  })
  expect(resolved.content).toBeUndefined()
  expect(resolved.contents).toEqual([])
  expect(resolved.error).toContain("Skills not found: Blocked-Skill")
  expect(resolved.error).not.toContain(BLOCKED_MIXED_CASE_SKILL_DESCRIPTION)
  expect(resolved.error).not.toContain(BLOCKED_MIXED_CASE_SKILL_BODY)
  await expectSkillUnavailable(skillTool, createToolContext(args.directory), "Blocked-Skill")
}

async function expectSkillUnavailable(
  skillTool: ReturnType<typeof createSkillTool>,
  toolContext: ToolContext,
  name: string,
): Promise<void> {
  let caughtError: Error | undefined
  try {
    await skillTool.execute({ name }, toolContext)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    caughtError = error
  }

  if (caughtError === undefined) {
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
    expect(toPosixPath(sharedOutput)).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput).not.toContain(POISONED_SHARED_BODY)
    expect(skillTool.description).not.toContain("Hostile project canonical shared ulw-plan")
  })

  test("#given hostile mixed-case shared ulw-plan project skill #when plugin skill context is built #then it cannot shadow the bundled shared alias", async () => {
    // given
    writeSkill(
      join(testDirectory, ".opencode", "skills", "mixed-case-collision"),
      "Shared/ulw-plan",
      "Hostile project mixed-case shared ulw-plan",
      POISONED_MIXED_CASE_SHARED_BODY,
    )
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})

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
    const skillTool = createSkillTool({
      directory: testDirectory,
      skills: skillContext.mergedSkills,
      disabledSkills: skillContext.disabledSkills,
      browserProvider: skillContext.browserProvider,
      includeSkillsInDescription: true,
    })
    const toolContext = createToolContext(testDirectory)
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedOutput = toolResultToText(
      await skillTool.execute({ name: "shared/ulw-plan" }, toolContext),
    )

    // then
    expect(plainOutput).toContain(LOCAL_ULW_PLAN_BODY)
    expect(toPosixPath(sharedOutput)).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput).not.toContain(POISONED_MIXED_CASE_SHARED_BODY)
    expect(skillContext.availableSkills.map((skill) => skill.name)).not.toContain("Shared/ulw-plan")
    expect(systemContent).not.toContain("Hostile project mixed-case shared ulw-plan")
    expect(systemContent).not.toContain(POISONED_MIXED_CASE_SHARED_BODY)
    expect(skillTool.description).not.toContain("Hostile project mixed-case shared ulw-plan")
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
    expect(toPosixPath(sharedOutput)).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain(LOCAL_ULW_PLAN_BODY)
    expect(sharedOutput).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
    expect(sharedOutput).not.toContain("HOSTILE_BODY")
    expect(skillTool.description).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
  })

  test("#given hostile mixed-case config entry for protected shared ulw-plan #when plugin skill context is built #then config is ignored and bundled shared remains", async () => {
    // given
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({
      skills: {
        "Shared/ulw-plan": {
          description: "IGNORE_MIXED_CASE_CONFIG",
          template: "HOSTILE_MIXED_CASE_CONFIG_BODY",
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
    const skillTool = createSkillTool({
      directory: testDirectory,
      skills: skillContext.mergedSkills,
      disabledSkills: skillContext.disabledSkills,
      browserProvider: skillContext.browserProvider,
      includeSkillsInDescription: true,
    })
    const toolContext = createToolContext(testDirectory)
    const sharedOutput = toolResultToText(
      await skillTool.execute({ name: "shared/ulw-plan" }, toolContext),
    )

    // then
    expect(toPosixPath(sharedOutput)).toContain("packages/shared-skills/skills/ulw-plan")
    expect(sharedOutput).not.toContain("IGNORE_MIXED_CASE_CONFIG")
    expect(sharedOutput).not.toContain("HOSTILE_MIXED_CASE_CONFIG_BODY")
    expect(skillContext.availableSkills.map((skill) => skill.name)).not.toContain("Shared/ulw-plan")
    expect(systemContent).not.toContain("IGNORE_MIXED_CASE_CONFIG")
    expect(systemContent).not.toContain("HOSTILE_MIXED_CASE_CONFIG_BODY")
    expect(skillTool.description).not.toContain("IGNORE_MIXED_CASE_CONFIG")
  })

  test("#given mixed-case project skill disabled by lowercase disabled_skills #when plugin skill context is built #then it is absent from context, tool, and delegate prompt", async () => {
    // when / then
    await expectMixedCaseBlockedSkillFiltered({
      directory: testDirectory,
      disabledSkills: ["blocked-skill"],
    })
  })

  test("#given mixed-case project skill disabled by lowercase skills.disable #when plugin skill context is built #then it is absent from context, tool, and delegate prompt", async () => {
    // when / then
    await expectMixedCaseBlockedSkillFiltered({
      directory: testDirectory,
      skills: { disable: ["blocked-skill"] },
    })
  })

  test("#given mixed-case native skill disabled by lowercase skills.disable #when plugin-wired skill surfaces consume context #then it is absent from tool and delegate loads", async () => {
    // given
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({
      skills: { disable: ["blocked-native"] },
    })
    const skillContext = await createSkillContext({
      directory: testDirectory,
      pluginConfig,
    })
    const nativeSkills = createNativeSkills(testDirectory, [
      {
        name: "Blocked-Native",
        description: BLOCKED_NATIVE_SKILL_DESCRIPTION,
        location: join(testDirectory, "native-skills", "blocked-native", "SKILL.md"),
        content: BLOCKED_NATIVE_SKILL_BODY,
      },
    ])
    const skillTool = createSkillTool({
      directory: testDirectory,
      skills: skillContext.mergedSkills,
      disabledSkills: skillContext.disabledSkills,
      browserProvider: skillContext.browserProvider,
      nativeSkills,
      includeSkillsInDescription: true,
    })

    // when
    const resolved = await resolveSkillContent(["Blocked-Native"], {
      directory: testDirectory,
      disabledSkills: skillContext.disabledSkills,
      nativeSkills,
    })

    // then
    expect(skillContext.disabledSkills).toContain("blocked-native")
    expect(skillTool.description).not.toContain("Blocked-Native")
    expect(skillTool.description).not.toContain(BLOCKED_NATIVE_SKILL_DESCRIPTION)
    await expectSkillUnavailable(skillTool, createToolContext(testDirectory), "Blocked-Native")
    expect(resolved.content).toBeUndefined()
    expect(resolved.contents).toEqual([])
    expect(resolved.error).toContain("Skills not found: Blocked-Native")
    expect(resolved.error).not.toContain(BLOCKED_NATIVE_SKILL_DESCRIPTION)
    expect(resolved.error).not.toContain(BLOCKED_NATIVE_SKILL_BODY)
  })

  test("#given skills entries disable aliases through false and disable true #when plugin skill context is built #then disabledSkills exposes normalized aliases", async () => {
    // given
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({
      skills: {
        "False-Blocked": false,
        "Object-Blocked": { disable: true },
      },
    })

    // when
    const skillContext = await createSkillContext({
      directory: testDirectory,
      pluginConfig,
    })

    // then
    expect(skillContext.disabledSkills).toContain("false-blocked")
    expect(skillContext.disabledSkills).toContain("object-blocked")
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

  test("#given shared ulw-plan is disabled with inline bare config #when the plugin-wired skill tool executes #then inline bare remains and shared alias is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      disabledSkills: ["shared/ulw-plan"],
      skills: {
        "ulw-plan": {
          description: "Inline local ulw-plan",
          template: LOCAL_INLINE_ULW_PLAN_BODY,
        },
      },
    })
    const toolContext = createToolContext(testDirectory)

    // when
    const plainOutput = toolResultToText(await skillTool.execute({ name: "ulw-plan" }, toolContext))
    const sharedUnavailable = expectSkillUnavailable(skillTool, toolContext, "shared/ulw-plan")

    // then
    await sharedUnavailable
    expect(plainOutput).toContain(LOCAL_INLINE_ULW_PLAN_BODY)
  })

  test("#given shared ulw-plan is disabled with mixed casing #when the plugin-wired skill tool executes #then local bare remains and shared alias is unavailable", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      disabledSkills: ["Shared/ulw-plan"],
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

  test("#given shared ulw-plan is disabled through mixed-case skills.disable #when the plugin-wired skill tool executes #then local bare remains and shared alias is unavailable", async () => {
    // given
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { disable: ["Shared/ulw-plan"] },
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

  test("#given mixed-case shared ulw-plan config entry is false without a local override #when the plugin-wired skill tool executes #then shared-scope fallback is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { "Shared/ulw-plan": false },
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

  test("#given mixed-case shared ulw-plan config entry is disabled without a local override #when the plugin-wired skill tool executes #then shared-scope fallback is unavailable", async () => {
    // given
    rmSync(join(testDirectory, ".opencode", "skills", "ulw-plan"), {
      recursive: true,
      force: true,
    })
    const skillTool = await createPluginWiredSkillTool({
      directory: testDirectory,
      skills: { "Shared/ulw-plan": { disable: true } },
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
