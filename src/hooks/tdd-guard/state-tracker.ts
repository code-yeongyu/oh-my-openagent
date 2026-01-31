/**
 * TDD State Tracker
 *
 * Tracks the current TDD state (RED/GREEN/REFACTOR) based on test execution results.
 * Provides state labels for terminal display.
 */

/**
 * TDD State enumeration
 */
export enum TddState {
  /** No tests or state not determined */
  NONE = "NONE",
  /** Failing tests exist - write minimal code to pass */
  RED = "RED",
  /** All tests pass - ready to refactor or write new test */
  GREEN = "GREEN",
  /** Refactoring while keeping tests green */
  REFACTOR = "REFACTOR",
}

/**
 * Test results for state calculation
 */
export interface TestResults {
  hasFailingTests: boolean
  passed: number
  failed: number
  total: number
}

/**
 * Test count summary
 */
export interface TestCount {
  passed: number
  failed: number
  total: number
}

/**
 * TDD State Tracker interface
 */
export interface TddStateTracker {
  /** Get current TDD state */
  getState(): TddState
  /** Get state label for terminal display */
  getStateLabel(): string
  /** Get test counts */
  getTestCount(): TestCount
  /** Update state from test results */
  updateFromTestResults(results: TestResults): void
  /** Enter refactor mode (only valid when GREEN) */
  enterRefactorMode(): void
  /** Exit refactor mode (returns to GREEN if tests pass) */
  exitRefactorMode(): void
  /** Reset tracker to initial state */
  reset(): void
}

/**
 * TDD State Tracker implementation
 */
class TddStateTrackerImpl implements TddStateTracker {
  private state: TddState = TddState.NONE
  private testCount: TestCount = { passed: 0, failed: 0, total: 0 }
  private inRefactorMode = false

  getState(): TddState {
    return this.state
  }

  getStateLabel(): string {
    return `[TDD: ${this.state}]`
  }

  getTestCount(): TestCount {
    return { ...this.testCount }
  }

  updateFromTestResults(results: TestResults): void {
    // Update test counts
    this.testCount = {
      passed: results.passed,
      failed: results.failed,
      total: results.total,
    }

    // No tests = NONE state
    if (results.total === 0) {
      this.state = TddState.NONE
      this.inRefactorMode = false
      return
    }

    // Failing tests = RED state (exits refactor mode)
    if (results.hasFailingTests) {
      this.state = TddState.RED
      this.inRefactorMode = false
      return
    }

    // All tests pass
    if (this.inRefactorMode) {
      // Stay in REFACTOR if we're refactoring and tests still pass
      this.state = TddState.REFACTOR
    } else {
      // Otherwise we're GREEN
      this.state = TddState.GREEN
    }
  }

  enterRefactorMode(): void {
    // Can only enter refactor mode when GREEN
    if (this.state === TddState.GREEN) {
      this.inRefactorMode = true
      this.state = TddState.REFACTOR
    }
  }

  exitRefactorMode(): void {
    if (this.inRefactorMode) {
      this.inRefactorMode = false
      // If tests were passing, go back to GREEN
      if (this.testCount.failed === 0 && this.testCount.total > 0) {
        this.state = TddState.GREEN
      }
    }
  }

  reset(): void {
    this.state = TddState.NONE
    this.testCount = { passed: 0, failed: 0, total: 0 }
    this.inRefactorMode = false
  }
}

/**
 * Create a new TDD State Tracker instance
 */
export function createTddStateTracker(): TddStateTracker {
  return new TddStateTrackerImpl()
}
