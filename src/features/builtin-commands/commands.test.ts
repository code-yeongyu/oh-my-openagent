import { describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import type { BuiltinCommandName } from "./types"

describe("loadBuiltinCommands", () => {
  test("should include handoff command in loaded commands", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = []

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.handoff).toBeDefined()
    expect(commands.handoff.name).toBe("handoff")
  })

  test("should exclude handoff when disabled", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = ["handoff"]

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.handoff).toBeUndefined()
  })

  test("should include handoff template content in command template", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.template).toContain(HANDOFF_TEMPLATE)
  })

  test("should include session context variables in handoff template", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.template).toContain("$SESSION_ID")
    expect(commands.handoff.template).toContain("$TIMESTAMP")
    expect(commands.handoff.template).toContain("$ARGUMENTS")
  })

  test("should have correct description for handoff", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.description).toContain("context summary")
  })
})

describe("HANDOFF_TEMPLATE", () => {
  test("should include session reading instruction", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("session_read")
  })

  test("should include compaction-style sections in output format", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("USER REQUESTS (AS-IS)")
    expect(HANDOFF_TEMPLATE).toContain("EXPLICIT CONSTRAINTS")
  })

  test("should include programmatic context gathering instructions", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("todoread")
    expect(HANDOFF_TEMPLATE).toContain("git diff")
    expect(HANDOFF_TEMPLATE).toContain("git status")
  })

  test("should include context extraction format", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("WORK COMPLETED")
    expect(HANDOFF_TEMPLATE).toContain("CURRENT STATE")
    expect(HANDOFF_TEMPLATE).toContain("PENDING TASKS")
    expect(HANDOFF_TEMPLATE).toContain("KEY FILES")
    expect(HANDOFF_TEMPLATE).toContain("IMPORTANT DECISIONS")
    expect(HANDOFF_TEMPLATE).toContain("CONTEXT FOR CONTINUATION")
    expect(HANDOFF_TEMPLATE).toContain("GOAL")
  })

  test("should enforce first person perspective", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("first person perspective")
  })

  test("should limit key files to 10", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("Maximum 10 files")
  })

  test("should instruct plain text format without markdown", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("Plain text with bullets")
    expect(HANDOFF_TEMPLATE).toContain("No markdown headers")
  })

  test("should include user instructions for new session", () => {
    //#given - the template string

    //#when / #then
    expect(HANDOFF_TEMPLATE).toContain("new session")
    expect(HANDOFF_TEMPLATE).toContain("opencode")
  })

  test("should not contain emojis", () => {
    //#given - the template string

    //#when / #then
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(HANDOFF_TEMPLATE)).toBe(false)
  })
})
