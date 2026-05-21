/// <reference types="bun-types" />
import { describe, expect, it, test } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { buildAvailableSkills } from "./available-skills"

type DiscoveredSkills = Parameters<typeof buildAvailableSkills>[0]

function makeSkill(name: string, agent?: string): LoadedSkill {
  return {
    name,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Skill ${name}`,
      template: "",
      agent,
    },
    scope: "user",
  }
}

describe("buildAvailableSkills", () => {
  test("includes team-mode when team mode is enabled", () => {
    // given
    const discoveredSkills: DiscoveredSkills = []

    // when
    const availableSkills = buildAvailableSkills(discoveredSkills, undefined, undefined, true)

    // then
    expect(availableSkills.some((skill) => skill.name === "team-mode")).toBe(true)
  })

  test("excludes team-mode when team mode is disabled", () => {
    // given
    const discoveredSkills: DiscoveredSkills = []

    // when
    const availableSkills = buildAvailableSkills(discoveredSkills, undefined, undefined, false)

    // then
    expect(availableSkills.some((skill) => skill.name === "team-mode")).toBe(false)
  })
})

describe("buildAvailableSkills - agentName filtering", () => {
  it("includes agent-restricted skill when agentName is not provided (backward compat)", () => {
    // given
    const skills = [makeSkill("oracle-only", "oracle")]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, undefined)

    // then: no agentName → no filtering, skill is included
    expect(result.map((s) => s.name)).toContain("oracle-only")
  })

  it("includes skill when agentName matches the skill's agent field", () => {
    // given
    const skills = [makeSkill("sisyphus-only", "sisyphus")]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then: matching agent → included
    expect(result.map((s) => s.name)).toContain("sisyphus-only")
  })

  it("excludes skill when agentName does not match the skill's agent field", () => {
    // given
    const skills = [makeSkill("sisyphus-only", "sisyphus")]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "oracle")

    // then: wrong agent → excluded
    expect(result.map((s) => s.name)).not.toContain("sisyphus-only")
  })

  it("includes skill with no agent field regardless of agentName", () => {
    // given
    const skills = [makeSkill("public-skill")]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then: no agent restriction → always included
    expect(result.map((s) => s.name)).toContain("public-skill")
  })

  it("filters per-agent while keeping public skills", () => {
    // given
    const skills = [
      makeSkill("public-skill"),
      makeSkill("sisyphus-only", "sisyphus"),
      makeSkill("oracle-only", "oracle"),
    ]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then
    const names = result.map((s) => s.name)
    expect(names).toContain("public-skill")
    expect(names).toContain("sisyphus-only")
    expect(names).not.toContain("oracle-only")
  })
})
