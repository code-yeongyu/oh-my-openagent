import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SkillDefinition } from "../../../config/schema"
import { configEntryToLoadedSkill } from "./config-skill-entry-loader"

describe("configEntryToLoadedSkill", () => {
  const fixtureRoot = join(tmpdir(), `config-skill-entry-loader-${Date.now()}`)
  const configDir = join(fixtureRoot, "config")
  const allowedSkillPath = join(configDir, "allowed-skill.md")
  const linkedSecretSkillPath = join(configDir, "linked-secret-skill.md")
  const outsideSkillPath = join(fixtureRoot, "secret-skill.md")

  beforeAll(() => {
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
