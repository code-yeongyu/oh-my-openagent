import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SkillDefinition } from "../../../config/schema"
import { configEntryToLoadedSkill } from "./config-skill-entry-loader"

describe("configEntryToLoadedSkill", () => {
  // mkdtempSync, never a Date.now()-derived name: consecutive Date.now() calls in one
  // process return the same millisecond, so sibling suites collided on one directory and
  // each teardown removed the other's live fixture. On Windows, removing an in-use tree
  // blocks until the hook budget expires ("a beforeEach/afterEach hook timed out").
  let fixtureRoot = ""
  let configDir = ""
  let allowedSkillPath = ""
  let linkedSecretSkillPath = ""
  let outsideSkillPath = ""

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "config-skill-entry-loader-"))
    configDir = join(fixtureRoot, "config")
    allowedSkillPath = join(configDir, "allowed-skill.md")
    linkedSecretSkillPath = join(configDir, "linked-secret-skill.md")
    outsideSkillPath = join(fixtureRoot, "secret-skill.md")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      allowedSkillPath,
      [
        "---",
        "description: Allowed skill",
        "---",
        "Use ./allowed.txt for context.",
      ].join("\n"),
      "utf8"
    )
    writeFileSync(
      outsideSkillPath,
      [
        "---",
        "description: Secret skill",
        "---",
        "Do not leak this.",
      ].join("\n"),
      "utf8"
    )
    symlinkSync(outsideSkillPath, linkedSecretSkillPath)
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("loads skills from files within configDir", () => {
    //#given
    const entry: SkillDefinition = { from: "./allowed-skill.md" }

    //#when
    const loaded = configEntryToLoadedSkill("allowed-skill", entry, configDir)

    //#then
    expect(loaded).not.toBeNull()
    expect(loaded?.definition.template).toContain("Use ./allowed.txt for context.")
  })

  test("rejects absolute skill files outside configDir", () => {
    //#given
    const entry: SkillDefinition = { from: outsideSkillPath }

    //#when
    const loaded = configEntryToLoadedSkill("secret-skill", entry, configDir)

    //#then
    expect(loaded).toBeNull()
  })

  test("rejects traversal skill files that escape configDir", () => {
    //#given
    const entry: SkillDefinition = { from: "../secret-skill.md" }

    //#when
    const loaded = configEntryToLoadedSkill("secret-skill", entry, configDir)

    //#then
    expect(loaded).toBeNull()
  })

  test("rejects symlink skill files that escape configDir", () => {
    //#given
    const entry: SkillDefinition = { from: "./linked-secret-skill.md" }

    //#when
    const loaded = configEntryToLoadedSkill("secret-skill", entry, configDir)

    //#then
    expect(loaded).toBeNull()
  })
})
