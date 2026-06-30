import { describe, it, expect, mock } from "bun:test"
import { createNativeSkillsAccessor, createRuntimeSkillsResolver, type RuntimeHostSkills } from "./runtime-skill-resolver"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { SkillLoadOptions } from "../tools/skill/types"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

function skill(name: string, mcp?: Record<string, unknown>): LoadedSkill {
  return {
    name,
    definition: { name, description: `Test skill ${name}` },
    scope: "config",
    ...(mcp ? { mcpConfig: mcp as LoadedSkill["mcpConfig"] } : {}),
  }
}

describe("createRuntimeSkillsResolver", () => {
  it("does NOT fetch the runtime config at construction (deadlock guard)", () => {
    // given
    let readCount = 0
    const base = [skill("playwright", { playwright: {} })]

    // when - resolver is created (this happens during plugin load)
    createRuntimeSkillsResolver({
      baseSkills: base,
      readRuntimeHostSkills: async () => {
        readCount += 1
        return undefined
      },
      buildMergedSkills: async () => base,
    })

    // then - no roundtrip happened at construction time
    expect(readCount).toBe(0)
  })

  it("on first call returns merged skills including a runtime-injected MCP skill not in base", async () => {
    // given - base lacks slack; runtime config injects a skill source that
    // surfaces a slack MCP skill (as the claude-bridge does at runtime)
    const base = [skill("playwright", { playwright: {} })]
    const hostSkills: RuntimeHostSkills = { paths: ["/cache/bridge/sjawhar"] }
    const merged = [...base, skill("slack-bot", { slack: {} })]

    const getLoadedSkills = createRuntimeSkillsResolver({
      baseSkills: base,
      readRuntimeHostSkills: async () => hostSkills,
      buildMergedSkills: async (hs) => {
        expect(hs).toBe(hostSkills)
        return merged
      },
    })

    // when
    const result = await getLoadedSkills()

    // then
    const slack = result.find((s) => s.name === "slack-bot")
    expect(slack).toBeDefined()
    expect(Boolean(slack?.mcpConfig && "slack" in slack.mcpConfig)).toBe(true)
  })

  it("caches: the runtime config is fetched at most once across calls", async () => {
    // given
    let readCount = 0
    let buildCount = 0
    const base = [skill("playwright", { playwright: {} })]
    const merged = [...base, skill("slack-bot", { slack: {} })]

    const getLoadedSkills = createRuntimeSkillsResolver({
      baseSkills: base,
      readRuntimeHostSkills: async () => {
        readCount += 1
        return { paths: ["/cache/bridge"] }
      },
      buildMergedSkills: async () => {
        buildCount += 1
        return merged
      },
    })

    // when - several concurrent + sequential calls
    const [a, b] = await Promise.all([getLoadedSkills(), getLoadedSkills()])
    const c = await getLoadedSkills()

    // then
    expect(readCount).toBe(1)
    expect(buildCount).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it("falls back to base skills when the runtime config is unavailable", async () => {
    // given
    const base = [skill("playwright", { playwright: {} })]
    const getLoadedSkills = createRuntimeSkillsResolver({
      baseSkills: base,
      readRuntimeHostSkills: async () => undefined,
      buildMergedSkills: async () => {
        throw new Error("must not be called when host skills are absent")
      },
    })

    // when
    const result = await getLoadedSkills()

    // then
    expect(result).toBe(base)
  })

  it("falls back to base skills when building merged skills throws", async () => {
    // given
    const base = [skill("playwright", { playwright: {} })]
    const getLoadedSkills = createRuntimeSkillsResolver({
      baseSkills: base,
      readRuntimeHostSkills: async () => ({ paths: ["/cache/bridge"] }),
      buildMergedSkills: async () => {
        throw new Error("discovery failed")
      },
    })

    // when
    const result = await getLoadedSkills()

    // then
    expect(result).toBe(base)
  })
})

describe("createNativeSkillsAccessor", () => {
  it("#given current OpenCode exposes app.skills #when native skills are loaded #then normal OpenCode skills are returned", async () => {
    const appSkills = mock(async (_parameters: unknown) => ({
      data: [
        {
          name: "customize-opencode",
          location: "<built-in>",
          content: "Use OpenCode config schemas.",
        },
        {
          name: "project-skill",
          description: "Project skill from .agents",
          location: "/tmp/project/.agents/skills/project-skill/SKILL.md",
          content: "Project skill body",
        },
      ],
    }))

    const nativeSkills = createNativeSkillsAccessor(unsafeTestValue({
      directory: "/tmp/project",
      client: { app: { skills: appSkills } },
    }))

    expect(nativeSkills).toBeDefined()
    expect(await nativeSkills?.all()).toEqual([
      {
        name: "customize-opencode",
        description: "",
        location: "<built-in>",
        content: "Use OpenCode config schemas.",
      },
      {
        name: "project-skill",
        description: "Project skill from .agents",
        location: "/tmp/project/.agents/skills/project-skill/SKILL.md",
        content: "Project skill body",
      },
    ])
    expect(await nativeSkills?.get("project-skill")).toEqual({
      name: "project-skill",
      description: "Project skill from .agents",
      location: "/tmp/project/.agents/skills/project-skill/SKILL.md",
      content: "Project skill body",
    })
    expect(await nativeSkills?.dirs()).toEqual(["/tmp/project/.agents/skills/project-skill"])
    expect(appSkills.mock.calls[0]?.[0]).toEqual({ directory: "/tmp/project" })
  })

  it("#given app.skills needs the generated SDK query shape #when direct loading has no data #then it falls back to query.directory", async () => {
    const appSkills = mock(async (parameters: unknown) => {
      if (parameters && typeof parameters === "object" && "query" in parameters) {
        return {
          data: [{
            name: "query-shape-skill",
            description: "Older generated SDK shape",
            location: "/tmp/project/.opencode/skills/query-shape-skill/SKILL.md",
            content: "Query shape body",
          }],
        }
      }
      return { data: [] }
    })

    const nativeSkills = createNativeSkillsAccessor(unsafeTestValue({
      directory: "/tmp/project",
      client: { app: { skills: appSkills } },
    }))

    expect(await nativeSkills?.all()).toEqual([{
      name: "query-shape-skill",
      description: "Older generated SDK shape",
      location: "/tmp/project/.opencode/skills/query-shape-skill/SKILL.md",
      content: "Query shape body",
    }])
    expect(appSkills.mock.calls[1]?.[0]).toEqual({ query: { directory: "/tmp/project" } })
  })

  it("#given app.skills throws #when native skills are loaded #then it degrades to an empty accessor result", async () => {
    const appSkills = mock(async () => {
      throw new Error("skill endpoint unavailable")
    })

    const nativeSkills = createNativeSkillsAccessor(unsafeTestValue({
      directory: "/tmp/project",
      client: { app: { skills: appSkills } },
    }))

    expect(await nativeSkills?.all()).toEqual([])
    expect(await nativeSkills?.get("missing")).toBeUndefined()
    expect(await nativeSkills?.dirs()).toEqual([])
  })

  it("#given a legacy PluginInput.skills accessor #when native skills are requested #then it is preferred over app.skills", async () => {
    const legacySkills: NonNullable<SkillLoadOptions["nativeSkills"]> = {
      all() {
        return [{
          name: "legacy-skill",
          description: "Legacy native skill",
          location: "/tmp/legacy/skills/legacy-skill/SKILL.md",
          content: "Legacy body",
        }]
      },
      get(name: string) {
        return name === "legacy-skill"
          ? {
            name: "legacy-skill",
            description: "Legacy native skill",
            location: "/tmp/legacy/skills/legacy-skill/SKILL.md",
            content: "Legacy body",
          }
          : undefined
      },
      dirs() {
        return ["/tmp/legacy/skills/legacy-skill"]
      },
    }
    const appSkills = mock(async () => ({
      data: [{
        name: "app-skill",
        description: "App skill",
        location: "/tmp/app/skills/app-skill/SKILL.md",
        content: "App body",
      }],
    }))

    const nativeSkills = createNativeSkillsAccessor(unsafeTestValue({
      directory: "/tmp/project",
      client: { app: { skills: appSkills } },
      skills: legacySkills,
    }))

    expect(await nativeSkills?.all()).toEqual([{
      name: "legacy-skill",
      description: "Legacy native skill",
      location: "/tmp/legacy/skills/legacy-skill/SKILL.md",
      content: "Legacy body",
    }])
    expect(appSkills).not.toHaveBeenCalled()
  })
})
