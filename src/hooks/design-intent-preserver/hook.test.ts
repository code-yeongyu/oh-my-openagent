import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createDesignIntentPreserverHook } from "./index"

describe("design-intent-preserver", () => {
  let tempDir: string
  let plansDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "design-intent-test-"))
    plansDir = join(tempDir, ".matrixx", "plans")
    mkdirSync(plansDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createMockPluginInput() {
    return {
      client: {},
      directory: tempDir,
    } as unknown as PluginInput
  }

  function createMockOutput(text: string) {
    return {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text }],
    }
  }

  test("injects guardrail when phase transition detected and plan has construct category", async () => {
    //#given - a plan with construct category and a Phase 2 transition message
    writeFileSync(
      join(plansDir, "2026-01-01-feat.md"),
      "# Feature Plan\n\n## Phase 1: UI\ncategory: construct\nweb-designer\n\n## Phase 2: Backend\ncategory: source\n"
    )
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("Phase 2: implement backend now")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - guardrail is prepended
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("design-intent-preservation")
    expect(textPart?.text).toContain("FROZEN")
    expect(textPart?.text).toContain("Phase 2: implement backend now")
  })

  test("skips guardrail when no phase transition in message", async () => {
    //#given - a plan with construct but message has no phase marker
    writeFileSync(
      join(plansDir, "plan.md"),
      "category: construct\nweb-designer\n"
    )
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("just a regular user message")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - text remains unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toBe("just a regular user message")
  })

  test("skips guardrail when plan has no construct reference", async () => {
    //#given - a plan without construct category and a Phase 2 message
    writeFileSync(
      join(plansDir, "plan.md"),
      "# Plan\n\n## Phase 1: Setup\ncategory: source\n\n## Phase 2: Build\ncategory: source\n"
    )
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("Phase 2: build feature")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - no guardrail injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toBe("Phase 2: build feature")
  })

  test("no-ops when no plans directory exists", async () => {
    //#given - no plans directory
    rmSync(join(tempDir, ".matrixx"), { recursive: true, force: true })
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("Phase 2: anything")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - no guardrail injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toBe("Phase 2: anything")
  })

  test("is idempotent - does not double-inject if guardrail already present", async () => {
    //#given - a plan with construct and a message already containing guardrail
    writeFileSync(
      join(plansDir, "plan.md"),
      "category: construct\nweb-designer\n"
    )
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const guardrailText = "Phase 2: x\n\n<design-intent-preservation>\nFROZEN\n</design-intent-preservation>"
    const output = createMockOutput(guardrailText)

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - guardrail appears only once
    const textPart = output.parts.find(p => p.type === "text")
    const matches = textPart?.text.match(/<design-intent-preservation>/g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(1)
  })

  test("uses most recent plan when multiple plans exist", async () => {
    //#given - two plans, older with construct, newer without
    writeFileSync(
      join(plansDir, "2026-01-01-old.md"),
      "category: construct\nweb-designer\n"
    )
    // Set mtime to make new.md more recent
    const newPath = join(plansDir, "2026-12-31-new.md")
    writeFileSync(newPath, "category: source\n")
    const future = new Date(Date.now() + 10000)
    const { utimesSync } = require("node:fs")
    utimesSync(newPath, future, future)

    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("Phase 2: do thing")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - no guardrail (newest plan has no construct)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toBe("Phase 2: do thing")
  })

  test("detects construct via web-designer agent reference in plan", async () => {
    //#given - plan with web-designer reference
    writeFileSync(
      join(plansDir, "plan.md"),
      "# UI work\nagent: web-designer\nskill: frontend-ui-ux\n"
    )
    const hook = createDesignIntentPreserverHook(createMockPluginInput())
    const output = createMockOutput("Phase 3: now switch to backend")

    //#when - hook processes the message
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then - guardrail injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toContain("design-intent-preservation")
  })
})
