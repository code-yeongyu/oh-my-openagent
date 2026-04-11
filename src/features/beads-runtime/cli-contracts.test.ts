import { describe, expect, test } from "bun:test"

import {
  parseBeadsRuntimeListResult,
  parseBeadsRuntimeReadyResult,
  parseBeadsRuntimeShowResult,
} from "./cli-contracts"
import { BeadsRuntimeError } from "./errors"

describe("beads runtime cli contracts", () => {
  test("parses the upstream ready array contract", () => {
    const result = parseBeadsRuntimeReadyResult(
      JSON.stringify([
        { id: "bd-123", title: "Implement feature", status: "open" },
      ]),
    )

    expect(result).toEqual([{ id: "bd-123", title: "Implement feature", status: "open" }])
  })

  test("parses the upstream list page contract for in-progress issues", () => {
    const result = parseBeadsRuntimeListResult(
      JSON.stringify({
        issues: [{ id: "bd-123", title: "Implement feature", status: "in_progress" }],
        total: 1,
        limit: 10,
        offset: 0,
        has_more: false,
      }),
    )

    expect(result.issues).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.has_more).toBe(false)
  })

  test("fails closed when ready json drifts away from the documented array shape", () => {
    expect(() => parseBeadsRuntimeReadyResult(JSON.stringify({ issues: [] }))).toThrow(
      BeadsRuntimeError,
    )
  })

  test("parses the supported show detail contract without making it the only required transport", () => {
    const result = parseBeadsRuntimeShowResult(
      JSON.stringify([
        { id: "bd-123", title: "Implement feature", description: "details" },
      ]),
    )

    expect(result).toEqual([
      { id: "bd-123", title: "Implement feature", description: "details" },
    ])
  })

  test("fails closed when show json drifts away from the documented detail array shape", () => {
    expect(() =>
      parseBeadsRuntimeShowResult(
        JSON.stringify({ id: "bd-123", title: "Implement feature", description: "details" }),
      ),
    ).toThrow(BeadsRuntimeError)
  })
})
