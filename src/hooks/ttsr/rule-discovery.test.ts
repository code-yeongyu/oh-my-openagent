/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { discoverTtsrRules } from "./rule-discovery"

const VALID_RULE = `---
ttsr: true
name: my-rule
condition: "hello"
---
Rule body content here
`

describe("#given discoverTtsrRules", () => {
  let tempRoot = ""
  let tempHome = ""
  let originalHome = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ttsr-discovery-project-"))
    tempHome = await mkdtemp(join(tmpdir(), "ttsr-discovery-home-"))
    originalHome = process.env.HOME ?? ""
    process.env.HOME = tempHome
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempRoot, { recursive: true, force: true })
    await rm(tempHome, { recursive: true, force: true })
  })

  describe("#when no rules directories exist", () => {
    describe("#then returns an empty array", () => {
      it("returns zero rules", async () => {
        const rules = await discoverTtsrRules(tempRoot)
        expect(rules).toEqual([])
      })
    })
  })

  describe("#when .claude/rules has valid TTSR markdown", () => {
    describe("#then parses and returns discovered rules", () => {
      it("returns one parsed rule with path", async () => {
        const claudeRulesDir = join(tempRoot, ".claude", "rules")
        await mkdir(claudeRulesDir, { recursive: true })
        const rulePath = join(claudeRulesDir, "valid-rule.md")
        await Bun.write(rulePath, VALID_RULE)

        const rules = await discoverTtsrRules(tempRoot)

        expect(rules).toHaveLength(1)
        expect(rules[0]?.name).toBe("valid-rule")
        expect(rules[0]?.path).toBe(rulePath)
      })
    })
  })

  describe("#when markdown file is non-TTSR", () => {
    describe("#then skips files that parse to null", () => {
      it("does not include invalid markdown files", async () => {
        const claudeRulesDir = join(tempRoot, ".claude", "rules")
        await mkdir(claudeRulesDir, { recursive: true })
        await Bun.write(join(claudeRulesDir, "not-a-rule.md"), "# plain markdown")

        const rules = await discoverTtsrRules(tempRoot)

        expect(rules).toHaveLength(0)
      })
    })
  })

  describe("#when rules exist in multiple project directories", () => {
    describe("#then discovers from .claude/rules and .sisyphus/rules", () => {
      it("returns both parsed rules", async () => {
        const claudeRulesDir = join(tempRoot, ".claude", "rules")
        const sisyphusRulesDir = join(tempRoot, ".sisyphus", "rules")
        await mkdir(claudeRulesDir, { recursive: true })
        await mkdir(sisyphusRulesDir, { recursive: true })
        await Bun.write(join(claudeRulesDir, "a.md"), VALID_RULE)
        await Bun.write(join(sisyphusRulesDir, "b.md"), VALID_RULE)

        const rules = await discoverTtsrRules(tempRoot)

        const names = rules.map((rule) => rule.name).sort()
        expect(names).toEqual(["a", "b"])
      })
    })
  })
})
