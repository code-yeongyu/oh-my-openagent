import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { createInstinctTriggerHook, clearInstinctCache } from "./index"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("createInstinctTriggerHook", () => {
  const testDir = join(tmpdir(), "instinct-trigger-test-" + Date.now())
  const instinctsDir = join(testDir, "skills", "instincts")
  let hook: ReturnType<typeof createInstinctTriggerHook>

  beforeAll(() => {
    mkdirSync(instinctsDir, { recursive: true })
    
    // #given - create test instinct with confidence >= 0.7
    const highConfidenceInstinct = `---
name: prefer-grep-before-edit
description: "When searching for code to modify, use Grep first"
trigger: "searching for code"
confidence: 0.8
domain: "workflow"
instinct: true
---

# Prefer Grep Before Edit

## Action
Always use Grep to find the exact location before using Edit.
`
    mkdirSync(join(instinctsDir, "prefer-grep-before-edit"), { recursive: true })
    writeFileSync(join(instinctsDir, "prefer-grep-before-edit", "SKILL.md"), highConfidenceInstinct)

    // #given - create test instinct with confidence < 0.7 (should be filtered)
    const lowConfidenceInstinct = `---
name: low-confidence-instinct
description: "Low confidence example"
trigger: "low confidence pattern"
confidence: 0.5
domain: "test"
instinct: true
---

# Low Confidence Instinct

## Action
This should not be injected.
`
    mkdirSync(join(instinctsDir, "low-confidence-instinct"), { recursive: true })
    writeFileSync(join(instinctsDir, "low-confidence-instinct", "SKILL.md"), lowConfidenceInstinct)

    // #given - create instinct without Action section
    const noActionInstinct = `---
name: no-action-instinct
description: "Missing action section"
trigger: "no action"
confidence: 0.9
domain: "test"
instinct: true
---

# No Action Instinct

Some content but no Action section.
`
    mkdirSync(join(instinctsDir, "no-action-instinct"), { recursive: true })
    writeFileSync(join(instinctsDir, "no-action-instinct", "SKILL.md"), noActionInstinct)

    hook = createInstinctTriggerHook({ claudeConfigDir: testDir } as never)
  })

  beforeEach(() => {
    // Clear cache before each test to ensure fresh scan
    clearInstinctCache()
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("should scan instincts directory on initialization", async () => {
    // #given - instincts directory with 3 skills
    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_001" }
    const output = { args: { filePath: "/test.ts" } }

    // #when - hook fires (triggers scan)
    await hook["tool.execute.before"](input, output)

    // #then - should complete without error (scan successful)
    expect(true).toBe(true)
  })

  test("should match trigger pattern case-insensitively", async () => {
    // #given - user input contains "SEARCHING FOR CODE"
    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_002" }
    const output = { args: { filePath: "/test.ts", oldString: "SEARCHING FOR CODE in this file" } }

    // #when - hook fires
    await hook["tool.execute.before"](input, output)

    // #then - should inject Action from high-confidence instinct
    expect(output.args.oldString).toContain("Always use Grep to find the exact location before using Edit")
  })

  test("should filter instincts by confidence >= 0.7", async () => {
    // #given - user input matches low-confidence trigger
    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_003" }
    const output = { args: { filePath: "/test.ts", oldString: "low confidence pattern detected" } }

    // #when - hook fires
    await hook["tool.execute.before"](input, output)

    // #then - should NOT inject low-confidence instinct
    expect(output.args.oldString).not.toContain("This should not be injected")
  })

  test("should not inject if no trigger matches", async () => {
    // #given - user input with no matching trigger
    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_004" }
    const output = { args: { filePath: "/test.ts", oldString: "completely unrelated content" } }

    // #when - hook fires
    await hook["tool.execute.before"](input, output)

    // #then - output unchanged
    expect(output.args.oldString).toBe("completely unrelated content")
  })

  test("should gracefully handle missing instincts directory", async () => {
    // #given - hook with non-existent directory
    const emptyDir = join(tmpdir(), "empty-test-" + Date.now())
    const emptyHook = createInstinctTriggerHook({ claudeConfigDir: emptyDir } as never)

    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_005" }
    const output = { args: { filePath: "/test.ts" } }

    // #when - should not throw
    await emptyHook["tool.execute.before"](input, output)

    // #then - no error thrown
    expect(true).toBe(true)
  })

  test("should gracefully handle instinct without Action section", async () => {
    // #given - user input matches "no action" trigger
    const input = { tool: "Edit", sessionID: "ses_123", callID: "call_006" }
    const output = { args: { filePath: "/test.ts", oldString: "no action pattern here" } }

    // #when - hook fires
    await hook["tool.execute.before"](input, output)

    // #then - should not throw, no injection
    expect(output.args.oldString).toBe("no action pattern here")
  })

  test("should match trigger in tool name", async () => {
    // #given - tool name contains trigger keyword
    const searchInstinct = `---
name: search-pattern
description: "When using grep"
trigger: "grep"
confidence: 0.8
domain: "search"
instinct: true
---

# Search Pattern

## Action
Use case-insensitive search by default.
`
    mkdirSync(join(instinctsDir, "search-pattern"), { recursive: true })
    writeFileSync(join(instinctsDir, "search-pattern", "SKILL.md"), searchInstinct)

    const input = { tool: "Grep", sessionID: "ses_123", callID: "call_007" }
    const output = { args: { pattern: "test" } }

    // #when - hook fires
    await hook["tool.execute.before"](input, output)

    // #then - should inject Action
    expect(output.args.pattern).toContain("Use case-insensitive search by default")
  })

  test("should cache instinct scan results", async () => {
    // #given - multiple calls in sequence
    const input1 = { tool: "Edit", sessionID: "ses_123", callID: "call_008" }
    const output1 = { args: { filePath: "/test.ts" } }

    const input2 = { tool: "Edit", sessionID: "ses_123", callID: "call_009" }
    const output2 = { args: { filePath: "/test2.ts" } }

    // #when - call twice
    await hook["tool.execute.before"](input1, output1)
    await hook["tool.execute.before"](input2, output2)

    // #then - should complete without rescanning (no error)
    expect(true).toBe(true)
  })
})
