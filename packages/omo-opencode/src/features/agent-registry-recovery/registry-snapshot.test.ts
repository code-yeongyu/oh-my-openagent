import { describe, expect, test } from "bun:test"

import {
  _resetForTesting,
  getLastRecoveryAttemptAt,
  getAppliedRegistry,
  markRecoveryAttempted,
  recordAppliedRegistry,
} from "./registry-snapshot"

describe("registry-snapshot", () => {
  test("#given a fresh module #then no agent names are recorded", () => {
    _resetForTesting()
    expect(getAppliedRegistry()).toEqual([])
    expect(getLastRecoveryAttemptAt()).toBe(0)
  })

  test("#given recorded names #when read back #then the same names come out", () => {
    _resetForTesting()
    recordAppliedRegistry(["sisyphus", "atlas"])
    expect([...getAppliedRegistry()]).toEqual(["sisyphus", "atlas"])
  })

  test("#given an existing snapshot #when names are recorded again #then the snapshot is replaced not merged", () => {
    _resetForTesting()
    recordAppliedRegistry(["sisyphus", "atlas"])
    recordAppliedRegistry(["hephaestus"])
    expect([...getAppliedRegistry()]).toEqual(["hephaestus"])
  })

  test("#given a recovery attempt mark #when read back #then the timestamp is stored", () => {
    _resetForTesting()
    markRecoveryAttempted(1234)
    expect(getLastRecoveryAttemptAt()).toBe(1234)
  })

  test("#given mutated state #when reset for testing #then names and cooldown are cleared", () => {
    _resetForTesting()
    recordAppliedRegistry(["sisyphus"])
    markRecoveryAttempted(42)
    _resetForTesting()
    expect(getAppliedRegistry()).toEqual([])
    expect(getLastRecoveryAttemptAt()).toBe(0)
  })
})
