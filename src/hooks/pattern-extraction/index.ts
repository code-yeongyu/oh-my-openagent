import { log } from "../../shared/logger"
import { PatternAnalyzer, ExtractedPattern, SessionMessage } from "./pattern-analyzer"

/**
 * Options for configuring the pattern extraction hook
 */
export interface PatternExtractionOptions {
  /**
   * Callback invoked when a pattern is extracted from session history
   * Receives pattern metadata suitable for creating an instinct
   */
  onPatternExtracted?: (pattern: ExtractedPattern) => Promise<void>
}

/**
 * Event structure for session summarize
 */
interface SummarizeEvent {
  event: string
  sessionID?: string
  messages?: SessionMessage[]
  taskName?: string
}

/**
 * Creates a hook that extracts behavioral patterns from session history
 * during compaction/summarization
 *
 * Detects:
 * - Repeated workflows (same sequence 3+ times)
 * - Only successful tool sequences (no errors)
 * - Patterns with confidence >= 0.7
 *
 * Integrates with instinct system via onPatternExtracted callback
 *
 * @param options - Configuration options
 * @returns Hook object with event handler
 */
export function createPatternExtractionHook(
  options: PatternExtractionOptions = {}
) {
  const analyzer = new PatternAnalyzer()
  const { onPatternExtracted } = options

  return {
    event: async (event: SummarizeEvent): Promise<void> => {
      try {
        // Only process summarize events
        if (event.event !== "session.summarize") {
          return
        }

        if (!event.sessionID || !event.messages) {
          log("[pattern-extraction] Missing sessionID or messages", { event: event.event })
          return
        }

        log("[pattern-extraction] Analyzing session history", {
          sessionID: event.sessionID,
          messageCount: event.messages.length,
        })

        // Analyze patterns from session messages
        const patterns = analyzer.analyze(
          event.messages,
          event.sessionID,
          event.taskName
        )

        log("[pattern-extraction] Analysis complete", {
          sessionID: event.sessionID,
          patternsFound: patterns.length,
        })

        // Invoke callback for each detected pattern
        if (patterns.length > 0 && onPatternExtracted) {
          for (const pattern of patterns) {
            // Fire and forget - don't block on callback
            onPatternExtracted(pattern).catch((err) => {
              log("[pattern-extraction] Callback failed", {
                error: err instanceof Error ? err.message : String(err),
                pattern: pattern.name,
              })
            })
          }
        }
      } catch (err) {
        // Silent fail - don't block compaction
        log("[pattern-extraction] Error during pattern extraction", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }
}

export type { ExtractedPattern, SessionMessage } from "./pattern-analyzer"
