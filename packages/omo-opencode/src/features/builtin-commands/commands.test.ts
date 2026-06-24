/// <reference path="../../../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REFACTOR_TEMPLATE } from "./templates/refactor"
import { REMOVE_AI_SLOPS_TEMPLATE } from "./templates/remove-ai-slops"
import type { BuiltinCommandName } from "./types"
import { _resetForTesting, registerAgentName } from "../claude-code-session-state"

beforeEach(() => {
  _resetForTesting()
})

afterEach(() => {
  _resetForTesting()
})

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

  test("should default start-work to Atlas for static slash-command discovery", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands["start-work"].agent).toBe("atlas")
  })

  test("should preassign Sisyphus as the native agent for start-work when command config checks registered agents", () => {
    //#given - no atlas registration

    //#when
    const commands = loadBuiltinCommands(undefined, { useRegisteredAgents: true })

    //#then
    expect(commands["start-work"].agent).toBe("sisyphus")
  })

  test("should preassign Atlas as the native agent for start-work when Atlas is registered", () => {
    //#given
    registerAgentName("atlas")

    //#when
    const commands = loadBuiltinCommands(undefined, { useRegisteredAgents: true })

    //#then
    expect(commands["start-work"].agent).toBe("atlas")
  })
})

describe("loadBuiltinCommands - remove-ai-slops", () => {
  test("should include remove-ai-slops command in loaded commands", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = []

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands["remove-ai-slops"]).toBeDefined()
    expect(commands["remove-ai-slops"].name).toBe("remove-ai-slops")
  })

  test("should exclude remove-ai-slops when disabled", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = ["remove-ai-slops"]

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands["remove-ai-slops"]).toBeUndefined()
  })

  test("should include remove-ai-slops template content in command template", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands["remove-ai-slops"].template).toContain(REMOVE_AI_SLOPS_TEMPLATE)
  })
})

describe("REMOVE_AI_SLOPS_TEMPLATE", () => {
  test("should not contain team mode content in the base template", () => {
    //#given - the base template string, which is used when team mode is disabled

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("slop-squad")
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("team_create")
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("Team Mode Protocol")
  })
})

describe("loadBuiltinCommands - team mode gating for remove-ai-slops", () => {
  test("should exclude team mode addendum when teamModeEnabled is false", () => {
    //#given - team mode disabled
    const commands = loadBuiltinCommands(undefined, { teamModeEnabled: false })

    //#when / #then
    expect(commands["remove-ai-slops"].template).not.toContain("slop-squad")
    expect(commands["remove-ai-slops"].template).not.toContain("Team Mode Protocol")
  })

  test("should include team mode addendum when teamModeEnabled is true", () => {
    //#given - team mode enabled
    const commands = loadBuiltinCommands(undefined, { teamModeEnabled: true })

    //#when / #then
    expect(commands["remove-ai-slops"].template).toContain("slop-squad")
    expect(commands["remove-ai-slops"].template).toContain("Team Mode Protocol")
  })

  test("should default to team mode disabled when option is omitted", () => {
    //#given - no options passed at all
    const commands = loadBuiltinCommands()

    //#when / #then
    expect(commands["remove-ai-slops"].template).not.toContain("slop-squad")
  })
})

describe("REFACTOR_TEMPLATE", () => {
  test("should not contain team mode content in the base template", () => {
    //#given - the base template string, which is used when team mode is disabled

    //#when / #then
    expect(REFACTOR_TEMPLATE).not.toContain("refactor-squad")
    expect(REFACTOR_TEMPLATE).not.toContain("team_create")
    expect(REFACTOR_TEMPLATE).not.toContain("Team Mode Protocol")
  })
})

describe("loadBuiltinCommands - team mode gating for refactor", () => {
  test("should exclude team mode addendum when teamModeEnabled is false", () => {
    //#given - team mode disabled
    const commands = loadBuiltinCommands(undefined, { teamModeEnabled: false })

    //#when / #then
    expect(commands.refactor.template).not.toContain("refactor-squad")
    expect(commands.refactor.template).not.toContain("Team Mode Protocol")
  })

  test("should include team mode addendum when teamModeEnabled is true", () => {
    //#given - team mode enabled
    const commands = loadBuiltinCommands(undefined, { teamModeEnabled: true })

    //#when / #then
    expect(commands.refactor.template).toContain("refactor-squad")
    expect(commands.refactor.template).toContain("Team Mode Protocol")
  })
})
