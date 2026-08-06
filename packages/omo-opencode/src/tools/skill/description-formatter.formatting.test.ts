import { describe, expect, it } from "bun:test"
import { formatCombinedDescription } from "./description-formatter"
import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"
import {
  builtinSharedSkill,
  makeCommand,
  makeSkill,
  sharedSkill,
} from "./description-formatter.test-support"

describe("formatCombinedDescription with bare-name skills", () => {
  it("lists all skills when no name collisions exist", () => {
    const skills: SkillInfo[] = [
      makeSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/debugging")
    expect(result).toContain("/review-work")
  })

  it("keeps bare and qualified names distinct after the shared/ cutover", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/shared/debugging")
    expect(result).toContain("/debugging")
    expect(result).toContain("/review-work")
  })

  it("suppresses builtin commands that share an exact name with a skill", () => {
    const skills: SkillInfo[] = [
      makeSkill("refactor", "full refactor skill"),
      makeSkill("remove-ai-slops", "full cleanup skill"),
      makeSkill("start-work", "full start-work skill"),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "short refactor command"),
      makeCommand("remove-ai-slops", "short cleanup command"),
      makeCommand("start-work", "short start-work command"),
      makeCommand("handoff", "handoff command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })
    expect(result).toContain("/refactor")
    expect(result).toContain("/remove-ai-slops")
    expect(result).toContain("/start-work")
    expect(result).not.toContain("short refactor command")
    expect(result).not.toContain("short cleanup command")
    expect(result).not.toContain("short start-work command")
    expect(result).toContain("/handoff")
  })

  it("does not suppress builtin commands when no skill shares the exact name", () => {
    const skills: SkillInfo[] = [makeSkill("debugging")]
    const commands: CommandInfo[] = [makeCommand("refactor", "short refactor command")]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })
    expect(result).toContain("/debugging")
    expect(result).toContain("/refactor")
    expect(result).toContain("short refactor command")
  })
})
