/**
 * TDD State Tracker Tests
 *
 * Tests for tracking TDD state (RED/GREEN/REFACTOR)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  TddStateTracker,
  TddState,
  createTddStateTracker,
} from "./state-tracker"

describe("TddStateTracker", () => {
  let tracker: TddStateTracker

  beforeEach(() => {
    tracker = createTddStateTracker()
  })

  describe("initial state", () => {
    //#given a new tracker instance
    //#when getting the initial state
    //#then it should return NONE
    it("should return NONE as initial state", () => {
      expect(tracker.getState()).toBe(TddState.NONE)
    })

    it("should have no test count initially", () => {
      expect(tracker.getTestCount()).toEqual({ passed: 0, failed: 0, total: 0 })
    })
  })

  describe("state tracking", () => {
    //#given failing tests exist
    //#when updating with test results
    //#then state should be RED
    it("should track RED state when tests fail", () => {
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 5,
        failed: 2,
        total: 7,
      })

      expect(tracker.getState()).toBe(TddState.RED)
    })

    //#given all tests pass after being RED
    //#when updating with passing test results
    //#then state should transition to GREEN
    it("should transition to GREEN when all tests pass", () => {
      // First be in RED state
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 5,
        failed: 2,
        total: 7,
      })
      expect(tracker.getState()).toBe(TddState.RED)

      // Then all tests pass
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })
      expect(tracker.getState()).toBe(TddState.GREEN)
    })

    //#given state is GREEN
    //#when entering refactor mode
    //#then state should be REFACTOR
    it("should track REFACTOR state when explicitly set", () => {
      // First be in GREEN state
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })

      // Enter refactor mode
      tracker.enterRefactorMode()
      expect(tracker.getState()).toBe(TddState.REFACTOR)
    })

    //#given state is REFACTOR and tests still pass
    //#when updating with passing results
    //#then state should remain REFACTOR
    it("should remain in REFACTOR while tests pass", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })
      tracker.enterRefactorMode()

      // Update with passing tests
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })

      expect(tracker.getState()).toBe(TddState.REFACTOR)
    })

    //#given state is REFACTOR
    //#when tests fail
    //#then state should transition to RED
    it("should transition from REFACTOR to RED when tests fail", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })
      tracker.enterRefactorMode()

      // Tests fail during refactor
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 5,
        failed: 2,
        total: 7,
      })

      expect(tracker.getState()).toBe(TddState.RED)
    })
  })

  describe("state label", () => {
    it("should return correct label for NONE state", () => {
      expect(tracker.getStateLabel()).toBe("[TDD: NONE]")
    })

    it("should return correct label for RED state", () => {
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 0,
        failed: 1,
        total: 1,
      })
      expect(tracker.getStateLabel()).toBe("[TDD: RED]")
    })

    it("should return correct label for GREEN state", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 1,
        failed: 0,
        total: 1,
      })
      expect(tracker.getStateLabel()).toBe("[TDD: GREEN]")
    })

    it("should return correct label for REFACTOR state", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 1,
        failed: 0,
        total: 1,
      })
      tracker.enterRefactorMode()
      expect(tracker.getStateLabel()).toBe("[TDD: REFACTOR]")
    })
  })

  describe("test count tracking", () => {
    it("should track test counts correctly", () => {
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 10,
        failed: 3,
        total: 13,
      })

      expect(tracker.getTestCount()).toEqual({
        passed: 10,
        failed: 3,
        total: 13,
      })
    })
  })

  describe("reset", () => {
    it("should reset state to NONE", () => {
      tracker.updateFromTestResults({
        hasFailingTests: true,
        passed: 5,
        failed: 2,
        total: 7,
      })
      expect(tracker.getState()).toBe(TddState.RED)

      tracker.reset()
      expect(tracker.getState()).toBe(TddState.NONE)
      expect(tracker.getTestCount()).toEqual({ passed: 0, failed: 0, total: 0 })
    })
  })

  describe("no tests scenario", () => {
    //#given no tests are found
    //#when updating with empty results
    //#then state should be NONE
    it("should return NONE when no tests exist", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 0,
        failed: 0,
        total: 0,
      })

      expect(tracker.getState()).toBe(TddState.NONE)
    })
  })

  describe("exit refactor mode", () => {
    it("should exit refactor mode and return to GREEN if tests pass", () => {
      tracker.updateFromTestResults({
        hasFailingTests: false,
        passed: 7,
        failed: 0,
        total: 7,
      })
      tracker.enterRefactorMode()
      expect(tracker.getState()).toBe(TddState.REFACTOR)

      tracker.exitRefactorMode()
      expect(tracker.getState()).toBe(TddState.GREEN)
    })
  })
})
