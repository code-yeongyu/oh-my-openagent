import { describe, expect, test } from "bun:test"

import type { SkillDefinition } from "../../../types"
import type { LoadedSkill } from "../types"
import { mergeSkillDefinitions } from "./skill-definition-merger"

describe("mergeSkillDefinitions", () => {
  test("normalizes and deduplicates allowed-tools patches", () => {
    //#given
    const base: LoadedSkill = {
      name: "review-work",
      resolvedPath: "/skills/review-work",
      definition: {
        name: "review-work",
        description: "(builtin - Skill) Review work",
        template: "Review the diff.",
      },
      scope: "builtin",
      allowedTools: ["Read", "Grep"],
    }
    const patch: SkillDefinition = {
      "allowed-tools": [" Grep ", "", "Write", "Read"],
    }

    //#when
    const merged = mergeSkillDefinitions(base, patch)

    //#then
    expect(merged.allowedTools).toEqual(["Read", "Grep", "Write"])
  })
})
