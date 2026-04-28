/// <reference path="../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor"
import { REMOVE_AI_SLOPS_TEMPLATE, REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM } from "./templates/remove-ai-slops"
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

  test("should have correct description for handoff", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.description).toContain("context summary")
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

  test("should have correct description for remove-ai-slops", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands["remove-ai-slops"].description).toContain("AI-generated code smells")
  })
})

describe("REMOVE_AI_SLOPS_TEMPLATE", () => {
  test("should include phase structure", () => {
    //#given - the template string

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("Identify Changed Files")
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("Parallel AI Slop Removal")
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("Critical Review")
  })

  test("should reference ai-slop-remover skill", () => {
    //#given - the template string

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("ai-slop-remover")
  })

  test("should include safety verification checklist", () => {
    //#given - the template string

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("Safety Verification")
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("Behavior Preservation")
  })

  test("should detect the base branch dynamically instead of hardcoding main", () => {
    //#given - the template string

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain("git symbolic-ref refs/remotes/origin/HEAD")
    expect(REMOVE_AI_SLOPS_TEMPLATE).toContain('git merge-base "$BASE_BRANCH" HEAD')
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("git merge-base main HEAD")
  })

  test("should not contain team mode content in the base template", () => {
    //#given - the base template string, which is used when team mode is disabled

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("slop-squad")
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("team_create")
    expect(REMOVE_AI_SLOPS_TEMPLATE).not.toContain("Team Mode Protocol")
  })
})

describe("REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM", () => {
  test("should define the slop-squad team spec and lifecycle", () => {
    //#given - the team mode addendum, injected only when team mode is enabled

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain("slop-squad")
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain("team_create")
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain("team_task_create")
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain("team_delete")
  })

  test("should route review to external deep task instead of a team member", () => {
    //#given - reviewer must run outside the team because category routing downcasts to sisyphus-junior

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain('category="deep"')
  })

  test("should teach valid lead messaging examples", () => {
    //#given - the team mode addendum, injected only when team mode is enabled

    //#when / #then
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain('teamRunId=<id>, to="*"')
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).toContain('to="lead"')
    expect(REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM).not.toContain("to=sisyphus")
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

describe("REFACTOR_TEAM_MODE_ADDENDUM", () => {
  test("should define the refactor-squad team spec and lifecycle", () => {
    //#given - the team mode addendum, injected only when team mode is enabled

    //#when / #then
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("refactor-squad")
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("team_create")
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("team_task_create")
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("team_delete")
  })

  test("should require team staffing recommendation as part of the plan", () => {
    //#given - plan agent must output a staffing roster so Phase 5 can dispatch

    //#when / #then
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("Team Staffing Recommendation")
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("dispatch_path_recommendation")
  })

  test("should route verification to external deep task instead of a team member", () => {
    //#given - verifier runs outside the team because category routing downcasts to sisyphus-junior

    //#when / #then
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain('category="deep"')
  })

  test("should teach valid lead messaging examples", () => {
    //#given - the team mode addendum, injected only when team mode is enabled

    //#when / #then
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain('to="lead"')
    expect(REFACTOR_TEAM_MODE_ADDENDUM).toContain("teamRunId=<id>")
    expect(REFACTOR_TEAM_MODE_ADDENDUM).not.toContain("to=sisyphus")
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
