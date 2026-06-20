/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { builtinToLoadedSkill } from "./builtin-skill-converter"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import type { BuiltinSkill } from "../../builtin-skills/types"

const baseBuiltin: BuiltinSkill = {
  name: "debugging",
  description: "Debugging skill",
  template: "# Debugging\n",
}

describe("builtinToLoadedSkill", () => {
  // #given a built-in skill
  // #when converted to loaded skill
  // #then resolvedPath points to the skill directory in shared skills root
  test("#given a built-in skill #when converted to loaded skill #then resolvedPath points to the skill directory", () => {
    // given
    const builtin: BuiltinSkill = { ...baseBuiltin, name: "debugging" }

    // when
    const loaded = builtinToLoadedSkill(builtin)

    // then
    const expectedPath = join(sharedSkillsRootPath(), "debugging")
    expect(loaded.resolvedPath).toBe(expectedPath)
  })

  // #given a built-in skill
  // #when converted to loaded skill
  // #then the path is independent of process.cwd()
  test("#given a built-in skill #when converted to loaded skill #then resolvedPath does not fall back to process.cwd()", () => {
    // given
    const builtin: BuiltinSkill = { ...baseBuiltin, name: "frontend" }

    // when
    const loaded = builtinToLoadedSkill(builtin)

    // then
    expect(loaded.resolvedPath).toBeDefined()
    expect(loaded.resolvedPath).not.toBe(process.cwd())
    expect(loaded.resolvedPath).not.toBe("")
  })

  // #given multiple built-in skills
  // #when each is converted
  // #then each gets a distinct resolvedPath matching its name
  test("#given multiple built-in skills #when each is converted #then each resolvedPath matches its own name", () => {
    // given
    const skills: BuiltinSkill[] = [
      { ...baseBuiltin, name: "debugging" },
      { ...baseBuiltin, name: "frontend" },
      { ...baseBuiltin, name: "review-work" },
    ]

    // when
    const loaded = skills.map(builtinToLoadedSkill)

    // then
    for (let i = 0; i < skills.length; i++) {
      expect(loaded[i].resolvedPath).toBe(join(sharedSkillsRootPath(), skills[i].name))
    }
  })
})
