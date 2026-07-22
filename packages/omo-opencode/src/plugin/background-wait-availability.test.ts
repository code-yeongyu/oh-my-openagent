import { afterEach, describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config"
import { clearSessionAgent, setSessionAgent } from "../features/claude-code-session-state"
import { clearSessionTools, setSessionTools } from "../shared/session-tools-store"
import { createBackgroundWaitAvailability } from "./background-wait-availability"

afterEach(() => {
  clearSessionTools()
  clearSessionAgent("permission-session")
})

describe("createBackgroundWaitAvailability", () => {
  test("returns false when the nested parent session mask denies the wait tool", () => {
    // Given the wait tool is registered and the nested parent can launch work but cannot wait.
    setSessionTools("nested-denied", {
      call_omo_agent: true,
      "wait-for-background-tasks": false,
    })
    const isAvailable = createBackgroundWaitAvailability(
      OhMyOpenCodeConfigSchema.parse({}),
      () => true,
    )

    // When availability is resolved for the nested parent session.
    const result = isAvailable("nested-denied")

    // Then the effective prompt mask wins over permissive static defaults.
    expect(result).toBe(false)
  })

  test.each([
    [{ "wait-for-background-tasks": "allow", "*": "deny" }, false],
    [{ "*": "deny", "wait-for-background-tasks": "allow" }, true],
    [{ "wait-for-background-tasks": "allow", "wait-for-*": "deny" }, false],
    [{ "wait-for-*": "deny", "wait-for-background-tasks": "allow" }, true],
  ] as const)("uses the last matching ordered permission rule for %o", (permission, expected) => {
    // Given an active agent with ordered exact and wildcard wait-tool rules.
    setSessionAgent("permission-session", "Sisyphus - ultraworker")
    const isAvailable = createBackgroundWaitAvailability(
      OhMyOpenCodeConfigSchema.parse({ agents: { sisyphus: { permission } } }),
      () => true,
    )

    // When availability is resolved for the agent session.
    const result = isAvailable("permission-session")

    // Then the last wildcard-matching rule wins, matching OpenCode permission evaluation.
    expect(result).toBe(expected)
  })
})
