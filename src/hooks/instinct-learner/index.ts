import { PatternDetector } from "./pattern-detector"

/**
 * Options for configuring the instinct learner hook
 */
export interface InstinctLearnerOptions {
  /**
   * Callback invoked when a pattern is detected
   * Receives instinct metadata suitable for creating a skill
   */
  onInstinctDetected?: (instinct: {
    name: string
    trigger: string
    confidence: number
    action: string
    domain: string
  }) => Promise<void>
}

/**
 * Creates a hook that learns behavioral patterns from tool usage
 * 
 * Detects:
 * - Repeated workflows (same sequence 3+ times)
 * - User corrections (multiple consecutive edits)
 * - Error resolutions (error → fix → success)
 * 
 * Integrates with skill-create-and-change via onInstinctDetected callback
 * 
 * @param options - Configuration options
 * @returns Hook object with tool.execute.after and event handlers
 */
export function createInstinctLearnerHook(options: InstinctLearnerOptions = {}) {
  const detector = new PatternDetector()
  const { onInstinctDetected } = options

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      try {
        // Detect if this call was a failure - guard against undefined output
        const outputText = output.output ?? ""
        const outputLower = outputText.toLowerCase()
        const isFailure =
          outputLower.includes("error") ||
          outputLower.includes("failed") ||
          outputLower.includes("could not")

        // Record the tool call for pattern tracking
        detector.recordToolCall(input.sessionID, input.tool, !isFailure, output.metadata)

        // Detect patterns
        const patterns = detector.detectPatterns(input.sessionID)

        // Invoke callback for each detected pattern
        if (patterns.length > 0 && onInstinctDetected) {
          for (const pattern of patterns) {
            // Fire and forget - don't block on callback
            onInstinctDetected(pattern).catch((err) => {
              console.warn(
                `[instinct-learner] Callback failed: ${err instanceof Error ? err.message : String(err)}`
              )
            })
          }
        }
      } catch (err) {
        // Silent fail - don't block execution
        console.warn(
          `[instinct-learner] Error during pattern detection: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },

    event: async (event: { event: string; sessionID?: string }): Promise<void> => {
      try {
        if (event.event === "session.deleted" && event.sessionID) {
          detector.cleanup(event.sessionID)
        }
      } catch (err) {
        // Silent fail
        console.warn(
          `[instinct-learner] Error during cleanup: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  }
}
