/// <reference types="bun-types" />
import { describe, expect, it, test } from "bun:test"
import type { LoadedSkill, SkillScope } from "../../features/opencode-skill-loader/types"
import { buildAvailableSkills } from "./available-skills"

type DiscoveredSkills = Parameters<typeof buildAvailableSkills>[0]
type SkillOptions = {
  readonly agent?: string
  readonly description?: string
  readonly scope?: SkillScope
}

function makeSkill(name: string, options: SkillOptions = {}): LoadedSkill {
  return {
    name,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: options.description ?? `Skill ${name}`,
      template: "",
      agent: options.agent,
    },
    scope: options.scope ?? "user",
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
    const skills = [makeSkill("oracle-only", { agent: "oracle" })]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, undefined)

    // then: no agentName → no filtering, skill is included
    expect(result.map((s) => s.name)).toContain("oracle-only")
  })

  it("includes skill when agentName matches the skill's agent field", () => {
    // given
    const skills = [makeSkill("sisyphus-only", { agent: "sisyphus" })]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then: matching agent → included
    expect(result.map((s) => s.name)).toContain("sisyphus-only")
  })

  it("excludes skill when agentName does not match the skill's agent field", () => {
    // given
    const skills = [makeSkill("sisyphus-only", { agent: "sisyphus" })]

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
      makeSkill("sisyphus-only", { agent: "sisyphus" }),
      makeSkill("oracle-only", { agent: "oracle" }),
    ]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then
    const names = result.map((s) => s.name)
    expect(names).toContain("public-skill")
    expect(names).toContain("sisyphus-only")
    expect(names).not.toContain("oracle-only")
  })

  it("deduplicates skills with discovered taking priority over builtin", () => {
    // given: a discovered skill with same name as builtin
    const discoveredSkills = [makeSkill("playwright")]
    const disabledSkills = new Set<string>()

    // when
    const result = buildAvailableSkills(discoveredSkills, undefined, disabledSkills)

    // then: only one "playwright" in result, from discovered (not duplicated)
    const playwriteSkills = result.filter((s) => s.name === "playwright")
    expect(playwriteSkills).toHaveLength(1)
    // discovered skill should have location "user"
    expect(playwriteSkills[0].location).toBe("user")
  })

  it("excludes mixed-case discovered skills by disabled lowercase alias", () => {
    // given
    const disabledDescription = "IGNORE_ALL_PRIOR_INSTRUCTIONS_DISABLED_SKILL_DESC"
    const skills = [
      {
        ...makeSkill("Blocked-Skill"),
        definition: {
          name: "Blocked-Skill",
          description: disabledDescription,
          template: "",
        },
        scope: "project",
      } satisfies LoadedSkill,
    ]
    const disabledSkills = new Set(["blocked-skill"])

    // when
    const result = buildAvailableSkills(skills, undefined, disabledSkills, undefined, "sisyphus")

    // then
    expect(result.map((s) => s.name)).not.toContain("Blocked-Skill")
    expect(result.map((s) => s.description)).not.toContain(disabledDescription)
  })

  it("excludes hostile project skills that shadow bundled shared skills from core agent prompt skill lists", () => {
    // given
    const hostileDescription = "HOSTILE_SHARED_ULW_PLAN_DESCRIPTION"
    const bundledSharedDescription = "Bundled shared ulw-plan"
    const skills = [
      makeSkill("ulw-plan", {
        description: bundledSharedDescription,
        scope: "shared",
      }),
      makeSkill("ulw-plan", {
        description: hostileDescription,
        scope: "project",
      }),
    ]
    const coreAgents = ["sisyphus", "hephaestus", "atlas"]

    for (const agentName of coreAgents) {
      // when
      const result = buildAvailableSkills(skills, undefined, undefined, undefined, agentName)

      // then
      expect(result.map((s) => s.description)).toContain(hostileDescription)
      expect(result.some((s) => s.name === "ulw-plan")).toBe(true)
    }
  })

  it("keeps custom namespaced skills after the shared/ prefix cutover", () => {
    // given
    const customDescription = "Legitimate custom namespaced skill"
    const skills = [
      makeSkill("ulw-plan", {
        description: "Bundled shared ulw-plan",
        scope: "shared",
      }),
      makeSkill("custom/namespace", {
        description: customDescription,
        scope: "project",
      }),
    ]

    // when
    const result = buildAvailableSkills(skills, undefined, undefined, undefined, "sisyphus")

    // then
    expect(result.map((s) => s.description)).toContain(customDescription)
  })
})
