/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { diffJsonBodies } from "./structural-diff"

describe("structural diff", () => {
  test("diffJsonBodies #given nested JSON #when compared #then changed and identical paths are classified", () => {
    const diff = diffJsonBodies('{"a":1,"b":{"c":2}}', '{"a":1,"b":{"c":3},"d":4}')
    expect(diff.identical_fields).toContain("a")
    expect(diff.changed_fields).toContain("b.c")
    expect(diff.diffs.some((entry) => entry.path === "d" && entry.kind === "added")).toBe(true)
    expect(diff.structural_analysis.structural_similarity).toBeGreaterThan(0)
  })
})
