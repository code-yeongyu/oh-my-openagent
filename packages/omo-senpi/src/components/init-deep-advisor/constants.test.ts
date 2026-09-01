/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  CANDIDATE_MAX_DEPTH,
  CANDIDATE_MIN_FILES,
  CANDIDATE_MIN_LOC,
  CHURN_LOC_RATIO_THRESHOLD,
  COMMIT_DISTANCE_THRESHOLD,
  COOLDOWN_DAYS,
  DAYS_SINCE_THRESHOLD,
  EXCLUDED_DIR_NAMES,
  MISSING_COVERAGE_RATIO_THRESHOLD,
  SOURCE_EXTENSIONS,
  TOUCHED_RATIO_THRESHOLD,
} from "./constants"

describe("frozen advisor constants", () => {
  test("#given the frozen plan values #when reading coverage constants #then they match exactly", () => {
    // given / when / then
    expect(MISSING_COVERAGE_RATIO_THRESHOLD).toBe(0.5)
    expect(CANDIDATE_MIN_FILES).toBe(8)
    expect(CANDIDATE_MIN_LOC).toBe(500)
    expect(CANDIDATE_MAX_DEPTH).toBe(3)
  })

  test("#given the frozen plan values #when reading drift constants #then they match exactly", () => {
    // given / when / then
    expect(COMMIT_DISTANCE_THRESHOLD).toBe(30)
    expect(TOUCHED_RATIO_THRESHOLD).toBe(0.15)
    expect(CHURN_LOC_RATIO_THRESHOLD).toBe(0.25)
    expect(DAYS_SINCE_THRESHOLD).toBe(90)
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
