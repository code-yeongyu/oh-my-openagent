/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createSkillTool } from "./tools"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { createRuntimeSkillsResolver } from "../../plugin/runtime-skill-resolver"
import { createSkillContext } from "../../plugin/skill-context"
import { OhMyOpenCodeConfigSchema } from "../../config"

function requireFresh<T>(modulePath: string): T {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
  return require(modulePath) as T
}

function createFreshSkillTool(
  ...args: Parameters<typeof import("./tools").createSkillTool>
): ReturnType<typeof import("./tools").createSkillTool> {
  return requireFresh<typeof import("./tools")>("./tools").createSkillTool(...args)
}

function createMockSkill(name: string): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `<skill-instruction>Body for ${name}</skill-instruction>`,
    },
    scope: "config",
  }
}

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("skill tool - getLoadedSkills runtime resolver (execute path)", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-resolver-test-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("#given a plugin-registered skill reachable only via getLoadedSkills #when execute(name) is called #then the skill body is returned (not 'not found')", async () => {
    // given — a skill that simulates a plugin-registered path: only the runtime
    // resolver knows about it. The static `skills` array is empty, mirroring
    // createTools() which cannot see plugin paths at load time.
    const pluginSkill = createMockSkill("plugin-registered-skill")
    let resolverCallCount = 0
    const tool = createFreshSkillTool({
      directory: testDir,
      skills: [],
      commands: [],
      getLoadedSkills: async () => {
        resolverCallCount += 1
        return [pluginSkill]
      },
    })

    // when — the agent invokes the skill tool by name (the real user path)
    const result = await tool.execute({ name: "plugin-registered-skill" }, mockContext)

    // then — execute consulted the resolver and returned the skill body
    expect(resolverCallCount).toBeGreaterThanOrEqual(1)
    expect(result).toContain("## Skill: plugin-registered-skill")
    expect(result).toContain("Body for plugin-registered-skill")
  })

  it("#given getLoadedSkills is set but skills is unset and commands is set #when execute(name) is called #then the resolver still resolves (no description-path dependency)", async () => {
    // given — edge case: no static `skills`, only `commands` (which sets a
    // command-only sync description). Execute must still reach the resolver.
    const pluginSkill = createMockSkill("edge-plugin-skill")
    const tool = createFreshSkillTool({
      directory: testDir,
      commands: [],
      getLoadedSkills: async () => [pluginSkill],
    })

    // when
    const result = await tool.execute({ name: "edge-plugin-skill" }, mockContext)

    // then
    expect(result).toContain("## Skill: edge-plugin-skill")
  })

  it("#given getLoadedSkills is unset #when execute runs #then falls back to the static skills array (no regression)", async () => {
    // given — legacy callers that pass only `skills` must keep working
    const staticSkill = createMockSkill("static-skill")
    const tool = createFreshSkillTool({
      directory: testDir,
      skills: [staticSkill],
      commands: [],
    })

    // when
    const result = await tool.execute({ name: "static-skill" }, mockContext)

    // then
    expect(result).toContain("## Skill: static-skill")
  })

  it("#given the real runtime resolver chain (resolver + createSkillContext) wired against a plugin skill dir #when execute runs #then the skill is discovered and returned", async () => {
    // given — a real SKILL.md on disk that simulates a plugin-registered path
    // injected into opencode's merged config. readRuntimeHostSkills returns
    // that path the way client.config.get() would post-startup. This exercises
    // the full production wiring (resolver -> createSkillContext ->
    // discoverConfigSourceSkills -> createSkillTool.execute) minus the real
    // opencode client.
    const skillName = "zz-integration-plugin-skill"
    const pluginSkillDir = mkdtempSync(join(tmpdir(), "plugin-skill-"))
    const skillSubdir = join(pluginSkillDir, skillName)
    mkdirSync(skillSubdir, { recursive: true })
    writeFileSync(
      join(skillSubdir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: integration test plugin skill\n---\nIntegration body.\n`,
    )

    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    const getLoadedSkills = createRuntimeSkillsResolver({
      baseSkills: [],
      readRuntimeHostSkills: async () => ({ paths: [pluginSkillDir] }),
      buildMergedSkills: async (hostSkills) =>
        (await createSkillContext({ directory: testDir, pluginConfig, hostSkills })).mergedSkills,
    })

    const tool = createFreshSkillTool({
      directory: testDir,
      skills: [],
      commands: [],
      getLoadedSkills,
    })

    try {
      // when
      const result = await tool.execute({ name: skillName }, mockContext)

      // then
      expect(result).toContain(`## Skill: ${skillName}`)
      expect(result).toContain("Integration body.")
    } finally {
      rmSync(pluginSkillDir, { recursive: true, force: true })
    }
  })
})
