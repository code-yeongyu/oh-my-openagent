import { describe, expect, it } from "bun:test"
import { createBuiltinSkills } from "../builtin-skills/skills"
import { getSharedSkillSourceDir } from "../builtin-skills/skill-file-loader"
import type { BuiltinSkill } from "../builtin-skills/types"
import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import { mergeSkills } from "./merger"
import type { LoadedSkill, SkillScope } from "./types"

function createLoadedSkill(scope: SkillScope, name: string, description: string): LoadedSkill {
  const definition: CommandDefinition = {
    name,
    description,
    template: "template",
  }

  return {
    name,
    definition,
    scope,
  }
}

describe("mergeSkills", () => {
  it("gives higher scopes priority over config source skills", () => {
    // given
    const builtinSkills: BuiltinSkill[] = [
      {
        name: "priority-skill",
        description: "builtin",
        template: "builtin-template",
      },
    ]

    const configSourceSkills: LoadedSkill[] = [
      createLoadedSkill("config", "priority-skill", "config source"),
    ]
    const userSkills: LoadedSkill[] = [
      createLoadedSkill("user", "priority-skill", "user skill"),
    ]

    // when
    const merged = mergeSkills(
      builtinSkills,
      undefined,
      configSourceSkills,
      userSkills,
      [],
      [],
      [],
    )

    // then
    expect(merged).toHaveLength(1)
    expect(merged[0]?.scope).toBe("user")
    expect(merged[0]?.definition.description).toBe("user skill")
  })

  it("populates resolvedPath for shared-skills-backed builtin skills", () => {
    // given
    const builtinSkills = createBuiltinSkills()

    // when
    const merged = mergeSkills(builtinSkills, undefined, [], [], [], [], [])
    const debugging = merged.find((s) => s.name === "debugging")
    const frontend = merged.find((s) => s.name === "frontend")
    const visualQa = merged.find((s) => s.name === "visual-qa")

    // then
    expect(debugging?.resolvedPath).toBe(getSharedSkillSourceDir("debugging"))
    expect(frontend?.resolvedPath).toBe(getSharedSkillSourceDir("frontend"))
    expect(visualQa?.resolvedPath).toBe(getSharedSkillSourceDir("visual-qa"))
  })

  it("leaves resolvedPath undefined for non-shared builtin skills", () => {
    // given
    const builtinSkills = createBuiltinSkills({ browserProvider: "dev-browser" })

    // when
    const merged = mergeSkills(builtinSkills, undefined, [], [], [], [], [])
    const devBrowser = merged.find((s) => s.name === "dev-browser")

    // then
    expect(devBrowser?.resolvedPath).toBeUndefined()
  })

  it("prefers explicit sourceDir over inferred path", () => {
    // given
    const explicitDir = "/custom/skill/dir"
    const builtinSkills: BuiltinSkill[] = [
      { name: "custom-skill", description: "custom", template: "t", sourceDir: explicitDir },
    ]

    // when
    const merged = mergeSkills(builtinSkills, undefined, [], [], [], [], [])

    // then
    expect(merged[0]?.resolvedPath).toBe(explicitDir)
  })
})
