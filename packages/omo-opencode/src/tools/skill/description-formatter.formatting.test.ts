import { describe, expect, it } from "bun:test"
import { formatCombinedDescription } from "./description-formatter"
import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"
import {
  builtinSharedSkill,
  makeCommand,
  makeSkill,
  opencodeNativeSkill,
  sharedSkill,
} from "./description-formatter.test-support"

describe("formatCombinedDescription with path-alias deduplication", () => {
  it("omits the bare alias from the injected description", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/shared/debugging")
    expect(result).not.toContain("\n    <name>/debugging</name>")
    expect(result).toContain("/review-work")
  })

  it("omits shorter shared-derived builtin commands when the shared skill is listed", () => {
    const skills: SkillInfo[] = [
      sharedSkill("refactor", "full refactor skill"),
      sharedSkill("remove-ai-slops", "full cleanup skill"),
      sharedSkill("start-work", "full start-work skill"),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "short refactor command"),
      makeCommand("remove-ai-slops", "short cleanup command"),
      makeCommand("start-work", "short start-work command"),
      makeCommand("handoff", "handoff command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/shared/refactor</name>")
    expect(result).toContain("<name>/shared/remove-ai-slops</name>")
    expect(result).toContain("<name>/shared/start-work</name>")
    expect(result).not.toContain("\n    <name>/refactor</name>")
    expect(result).not.toContain("\n    <name>/remove-ai-slops</name>")
    expect(result).not.toContain("\n    <name>/start-work</name>")
    expect(result).not.toContain("short refactor command")
    expect(result).not.toContain("short cleanup command")
    expect(result).not.toContain("short start-work command")
    expect(result).toContain("handoff command")
  })

  it("keeps distinct project commands even when a shared skill has the same short name", () => {
    const skills: SkillInfo[] = [sharedSkill("refactor", "full refactor skill")]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "project refactor command", { scope: "project" }),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/shared/refactor</name>")
    expect(result).toContain("\n    <name>/refactor</name>")
    expect(result).toContain("full refactor skill")
    expect(result).toContain("project refactor command")
  })

  it("keeps builtin commands when the matching qualified skill is not shared-derived", () => {
    const skills: SkillInfo[] = [
      makeSkill("project/refactor", "project refactor skill", {
        scope: "project",
        location: "/repo/.agents/skills/project/refactor/SKILL.md",
      }),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "builtin refactor command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/project/refactor</name>")
    expect(result).toContain("\n    <name>/refactor</name>")
    expect(result).toContain("project refactor skill")
    expect(result).toContain("builtin refactor command")
  })

  it("keeps OpenCode-injected native skills while suppressing shared path aliases", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging", "full shared debugging"),
      builtinSharedSkill("debugging", "short debugging wrapper"),
      opencodeNativeSkill("opencode/customize-opencode", "Qualified OpenCode customize entry"),
      opencodeNativeSkill("customize-opencode", "Customize OpenCode"),
    ]

    const result = formatCombinedDescription(skills, [], { includeSkills: true })

    expect(result).toContain("<name>/shared/debugging</name>")
    expect(result).not.toContain("\n    <name>/debugging</name>")
    expect(result).toContain("<name>/customize-opencode</name>")
    expect(result).toContain("Customize OpenCode")
  })
})
