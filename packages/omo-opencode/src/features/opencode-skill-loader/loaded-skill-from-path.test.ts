import { describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs/promises"

import { loadSkillFromPath } from "./loaded-skill-from-path"

describe("loadSkillFromPath", () => {
  it("#given the skill file read throws a non-Error value #when loading a skill #then it returns the null fallback", async () => {
    // given
    const readFileSpy = spyOn(fs, "readFile").mockImplementation(() => {
      throw "read failed"
    })

    try {
      // when
      const result = await loadSkillFromPath({
        skillPath: "/tmp/example/SKILL.md",
        resolvedPath: "/tmp/example",
        defaultName: "example",
        scope: "opencode",
      })

      // then
      expect(result).toBeNull()
    } finally {
      readFileSpy.mockRestore()
    }
  })
})
