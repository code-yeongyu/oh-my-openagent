import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { builtinToLoadedSkill } from "./builtin-skill-converter"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { devBrowserSkill } from "../../builtin-skills/skills/dev-browser"
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

  // #given a built-in skill with an explicit base directory
  // #when converted to loaded skill
  // #then resolvedPath preserves that directory for local references
  test("#given a built-in skill with explicit path #when converted to loaded skill #then resolvedPath preserves local reference base", () => {
    // given
    const builtin: BuiltinSkill = { ...baseBuiltin, name: "dev-browser", resolvedPath: "/tmp/omo/dev-browser" }

    // when
    const loaded = builtinToLoadedSkill(builtin)

    // then
    expect(loaded.resolvedPath).toBe("/tmp/omo/dev-browser")
  })

  // #given the dev-browser built-in skill has local reference files
  // #when converted to loaded skill
  // #then resolvedPath points to the local skill asset directory
  test("#given dev-browser has local reference files #when converted #then resolvedPath points to local assets", () => {
    // given
    const loaded = builtinToLoadedSkill(devBrowserSkill)

    // when
    const resolvedPath = loaded.resolvedPath

    // then
    if (resolvedPath === undefined) {
      expect(resolvedPath).toBeDefined()
      return
    }
    expect(existsSync(join(resolvedPath, "references", "installation.md"))).toBe(true)
  })

  // #given an inline built-in skill without shared skill assets
  // #when converted to loaded skill
  // #then resolvedPath is not invented from the shared skills root
  test("#given an inline built-in skill without shared assets #when converted #then resolvedPath is left unset", () => {
    // given
    const builtin: BuiltinSkill = { ...baseBuiltin, name: "dev-browser" }
    const inventedSharedPath = join(sharedSkillsRootPath(), "dev-browser")
    expect(existsSync(inventedSharedPath)).toBe(false)

    // when
    const loaded = builtinToLoadedSkill(builtin)

    // then
    expect(loaded.resolvedPath).toBeUndefined()
  })
})
