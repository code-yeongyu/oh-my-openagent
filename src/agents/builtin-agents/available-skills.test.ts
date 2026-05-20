import { describe, expect, test } from "bun:test"

import { buildAvailableSkills } from "./available-skills"

type DiscoveredSkills = Parameters<typeof buildAvailableSkills>[0]

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
