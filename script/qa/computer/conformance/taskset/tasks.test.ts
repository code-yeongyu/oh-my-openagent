import { describe, expect, test } from "bun:test"

import { TASKS } from "./tasks.ts"

const WINDOW_SELECTOR = /desktop\.window\(\{([^}]*)\}\)|wait\(\{ window: \{([^}]*)\}/g

describe("task-set reference cells", () => {
  test("select their window by title, never by an app display name the engines match differently", () => {
    const selectors = TASKS.flatMap((task) =>
      task.cells.flatMap((cell) => [...cell.code.matchAll(WINDOW_SELECTOR)].map((match) => match[1] ?? match[2] ?? "")),
    )
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector).toMatch(/title: "Conformance Document( 2)?"/)
      expect(selector).not.toContain("app:")
    }
  })
})
