import { afterEach, describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config"
import { clearSessionTools, setSessionTools } from "../shared/session-tools-store"
import { createBackgroundWaitAvailability } from "./background-wait-availability"

afterEach(() => {
  clearSessionTools()
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
})
