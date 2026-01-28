/**
 * Record of a single tool call for pattern analysis
 */
export interface ToolCallRecord {
  tool: string
  timestamp: number
  success: boolean
  metadata?: unknown
}

/**
 * A detected behavioral pattern from tool call history
 */
export interface DetectedPattern {
  name: string
  trigger: string
  confidence: number
  action: string
  domain: string
}

/**
 * State tracking for a single session
 */
export interface SessionState {
  recentCalls: ToolCallRecord[]
}

const MAX_RECENT_CALLS = 50
const PATTERN_MIN_OCCURRENCES = 3
const SEQUENCE_LENGTH = 3

/**
 * Detects behavioral patterns from tool call sequences
 * 
 * Pattern types:
 * - Repeated workflows: Same sequence appearing 3+ times
 * - User corrections: Multiple consecutive edits (refinement pattern)
 * - Error resolutions: Error followed by successful fix
 */
export class PatternDetector {
  private sessionStates = new Map<string, SessionState>()

  private getOrCreateState(sessionID: string): SessionState {
    if (!this.sessionStates.has(sessionID)) {
      this.sessionStates.set(sessionID, {
        recentCalls: [],
      })
    }
    return this.sessionStates.get(sessionID)!
  }

  /**
   * Record a tool call for pattern tracking
   */
  recordToolCall(
    sessionID: string,
    toolName: string,
    success: boolean,
    metadata?: unknown
  ): void {
    const state = this.getOrCreateState(sessionID)
    state.recentCalls.push({
      tool: toolName,
      timestamp: Date.now(),
      success,
      metadata,
    })
    if (state.recentCalls.length > MAX_RECENT_CALLS) {
      state.recentCalls.shift()
    }
  }

  /**
   * Detect all patterns for a session
   * Returns array of detected patterns (may be empty)
   */
  detectPatterns(sessionID: string): DetectedPattern[] {
    const patterns: DetectedPattern[] = []

    // Detect repeated workflows
    const workflowPattern = this.detectRepeatedWorkflow(sessionID)
    if (workflowPattern) {
      patterns.push(workflowPattern)
    }

    // Detect user corrections
    const correctionPattern = this.detectUserCorrection(sessionID)
    if (correctionPattern) {
      patterns.push(correctionPattern)
    }

    // Detect error resolutions
    const errorResolutionPattern = this.detectErrorResolution(sessionID)
    if (errorResolutionPattern) {
      patterns.push(errorResolutionPattern)
    }

    return patterns
  }

  /**
   * Detect repeated workflow patterns (same tool sequence 3+ times)
   */
  private detectRepeatedWorkflow(sessionID: string): DetectedPattern | null {
    const state = this.sessionStates.get(sessionID)
    if (!state || state.recentCalls.length < SEQUENCE_LENGTH * PATTERN_MIN_OCCURRENCES) {
      return null
    }

    const calls = state.recentCalls
    const sequences = new Map<string, number>()

    // Extract sequences of SEQUENCE_LENGTH
    for (let i = 0; i <= calls.length - SEQUENCE_LENGTH; i++) {
      const sequence = calls
        .slice(i, i + SEQUENCE_LENGTH)
        .map((c) => c.tool)
        .join("->")
      sequences.set(sequence, (sequences.get(sequence) || 0) + 1)
    }

    // Find sequences that occur 3+ times
    for (const [sequence, count] of sequences) {
      if (count >= PATTERN_MIN_OCCURRENCES) {
        const tools = sequence.split("->")
        return {
          name: "repeated-workflow",
          trigger: `Repeated sequence: ${sequence}`,
          confidence: Math.min(0.9, 0.5 + count * 0.1),
          action: `Consider creating a shortcut for: ${tools.join(" → ")}`,
          domain: "workflow-optimization",
        }
      }
    }

    return null
  }

  /**
   * Detect user correction patterns (3+ consecutive edits)
   */
  private detectUserCorrection(sessionID: string): DetectedPattern | null {
    const state = this.sessionStates.get(sessionID)
    if (!state || state.recentCalls.length < 3) {
      return null
    }

    const calls = state.recentCalls
    let consecutiveEdits = 0
    let lastEditMetadata: unknown = null

    // Look for 3+ consecutive edits (potential correction pattern)
    for (let i = calls.length - 1; i >= Math.max(0, calls.length - 10); i--) {
      if (calls[i].tool === "edit") {
        consecutiveEdits++
        if (!lastEditMetadata) {
          lastEditMetadata = calls[i].metadata
        }
      } else {
        break
      }
    }

    if (consecutiveEdits >= 3) {
      return {
        name: "user-correction",
        trigger: "Multiple consecutive edits detected",
        confidence: 0.7,
        action: "User seems to be refining an edit. Consider reviewing the approach.",
        domain: "editing-pattern",
      }
    }

    return null
  }

  /**
   * Detect error resolution patterns (error → fix → success)
   */
  private detectErrorResolution(sessionID: string): DetectedPattern | null {
    const state = this.sessionStates.get(sessionID)
    if (!state || state.recentCalls.length < 3) {
      return null
    }

    const calls = state.recentCalls
    const recentCalls = calls.slice(-10)

    // Look for error followed by success pattern
    for (let i = 0; i < recentCalls.length - 2; i++) {
      const errorCall = recentCalls[i]
      const fixCall = recentCalls[i + 1]
      const successCall = recentCalls[i + 2]

      if (!errorCall.success && fixCall.success && successCall.success) {
        return {
          name: "error-resolution",
          trigger: `Error in ${errorCall.tool} resolved by ${fixCall.tool}`,
          confidence: 0.8,
          action: `Learn: ${errorCall.tool} errors can be fixed with ${fixCall.tool}`,
          domain: "error-handling",
        }
      }
    }

    return null
  }

  /**
   * Clean up session state when session is deleted
   */
  cleanup(sessionID: string): void {
    this.sessionStates.delete(sessionID)
  }

  /**
   * Get session state for inspection/testing
   */
  getState(sessionID: string): SessionState | undefined {
    return this.sessionStates.get(sessionID)
  }
}
