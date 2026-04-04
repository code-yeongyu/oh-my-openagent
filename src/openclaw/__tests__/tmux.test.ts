import { describe, expect, test } from "bun:test"
import { analyzePaneContent } from "../tmux"

describe("openclaw tmux helpers", () => {
  test("analyzePaneContent recognizes the opencode welcome prompt", () => {
    const content = "opencode\nAsk anything...\nRun /help"
    expect(analyzePaneContent(content).confidence).toBeGreaterThanOrEqual(1)
  })

  test("analyzePaneContent returns zero confidence for empty content", () => {
    expect(analyzePaneContent(null).confidence).toBe(0)
  })
})
