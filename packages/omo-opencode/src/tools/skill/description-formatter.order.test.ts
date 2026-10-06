import { describe, expect, it } from "bun:test"
import { formatCombinedDescription } from "./description-formatter"
import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"
import { localSkill, makeCommand, makeSkill, opencodeNativeSkill } from "./description-formatter.test-support"

function discoveredSkills(): SkillInfo[] {
  return [
    opencodeNativeSkill("deploy-model/preset", "preset desc", "/home/.agents/skills/pack/models/deploy-model/preset/SKILL.md"),
    opencodeNativeSkill("deploy-model/capacity", "capacity desc", "/home/.agents/skills/pack/models/deploy-model/capacity/SKILL.md"),
    localSkill("review-work"),
    opencodeNativeSkill("deploy-model/customize", "customize desc", "/home/.agents/skills/pack/models/deploy-model/customize/SKILL.md"),
    makeSkill("Zeta-upper"),
    makeSkill("alpha-lower"),
  ]
}

function discoveredCommands(): CommandInfo[] {
  return [
    makeCommand("handoff"),
    makeCommand("init-deep", "project init", { scope: "project" }),
    makeCommand("cancel-loop"),
    makeCommand("Bootstrap"),
  ]
}

describe("formatCombinedDescription ordering", () => {
  it("renders byte-identical descriptions for the same items discovered in different orders", () => {
    const forward = formatCombinedDescription(discoveredSkills(), discoveredCommands(), { includeSkills: true })
    const reversed = formatCombinedDescription(
      discoveredSkills().toReversed(),
      discoveredCommands().toReversed(),
      { includeSkills: true },
    )

    expect(reversed).toBe(forward)
  })

  it("renders byte-identical command-only descriptions for different discovery orders", () => {
    const forward = formatCombinedDescription([], discoveredCommands())
    const rotated = formatCombinedDescription([], [...discoveredCommands().slice(2), ...discoveredCommands().slice(0, 2)])

    expect(rotated).toBe(forward)
  })

  it("still lists higher-priority scopes first whatever the discovery order", () => {
    const result = formatCombinedDescription(discoveredSkills().toReversed(), [], { includeSkills: true })

    const projectIndex = result.indexOf("<name>/review-work</name>")
    const configIndex = result.indexOf("<name>/deploy-model/capacity</name>")
    expect(projectIndex).toBeGreaterThan(-1)
    expect(configIndex).toBeGreaterThan(projectIndex)
  })

  it("orders same-scope names by code unit, so the listing does not depend on the machine's locale", () => {
    const result = formatCombinedDescription(discoveredSkills().toReversed(), [], { includeSkills: true })

    // Code units put uppercase first; most locales would sort alpha-lower before Zeta-upper.
    const upperIndex = result.indexOf("<name>/Zeta-upper</name>")
    const lowerIndex = result.indexOf("<name>/alpha-lower</name>")
    expect(upperIndex).toBeGreaterThan(-1)
    expect(lowerIndex).toBeGreaterThan(upperIndex)
  })
})
