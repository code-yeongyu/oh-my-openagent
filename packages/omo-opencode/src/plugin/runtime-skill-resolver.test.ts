import { describe, it, expect } from "bun:test"
import { createRuntimeSkillsResolver, type RuntimeHostSkills } from "./runtime-skill-resolver"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

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
