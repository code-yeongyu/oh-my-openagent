/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  CANDIDATE_MAX_DEPTH,
  CANDIDATE_MIN_FILES,
  CANDIDATE_MIN_LOC,
  COMMIT_DISTANCE_THRESHOLD,
  COOLDOWN_DAYS,
  EXCLUDED_DIR_NAMES,
  SOURCE_EXTENSIONS,
  TOUCHED_RATIO_THRESHOLD,
} from "./constants"

// These defaults have no independent owner test: the behavioural suites use values on either side
// (depth 4, 600 LOC, 40 commits, 0.20 vs 0.05) or derive their expectation from the constant. The 0.50
// coverage ratio, the 0.25 churn ratio and the 90-day age are owned by coverage.test.ts and drift.test.ts.
describe("frozen advisor constants", () => {
  test("#given the frozen plan values #when reading coverage constants #then they match exactly", () => {
    // given / when / then
    expect(CANDIDATE_MIN_FILES).toBe(8)
    expect(CANDIDATE_MIN_LOC).toBe(500)
    expect(CANDIDATE_MAX_DEPTH).toBe(3)
  })

  test("#given the frozen plan values #when reading drift constants #then they match exactly", () => {
    // given / when / then
    expect(COMMIT_DISTANCE_THRESHOLD).toBe(30)
    expect(TOUCHED_RATIO_THRESHOLD).toBe(0.15)
    expect(COOLDOWN_DAYS).toBe(7)
  })

  test("#given the frozen source extension set #when checking membership #then known source and excluded names are covered", () => {
    // given / when / then
    expect(SOURCE_EXTENSIONS.has(".ts")).toBe(true)
    expect(SOURCE_EXTENSIONS.has(".dart")).toBe(true)
    expect(SOURCE_EXTENSIONS.has(".md")).toBe(false)
    expect(EXCLUDED_DIR_NAMES.has("node_modules")).toBe(true)
    expect(EXCLUDED_DIR_NAMES.has(".git")).toBe(true)
    expect(EXCLUDED_DIR_NAMES.has("src")).toBe(false)
  })
})
