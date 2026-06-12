import { describe, expect, it } from "bun:test"
import type { BuiltinSkill } from "../builtin-skills/types"
import type { CommandDefinition } from "../claude-code-command-loader/types"
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
})
