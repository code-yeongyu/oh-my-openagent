import { AnomalyDetector } from "./detector"

export interface DelegateTaskFn {
  (args: {
    subagent_type: string
    run_in_background: boolean
    prompt: string
  }): Promise<unknown>
}

export interface ObserverDetectorHookOptions {
  delegateTask?: DelegateTaskFn
}

export function createObserverDetectorHook(options: ObserverDetectorHookOptions = {}) {
  const detector = new AnomalyDetector()
  const { delegateTask } = options

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      try {
        // Detect if this call was a failure
        const isFailure = detector.detectFailure(input.sessionID, output.output)

        // Record the tool call for history tracking
        detector.recordToolCall(input.sessionID, input.tool, !isFailure)

        // Detect loop pattern
        const loopWarning = detector.detectLoop(input.sessionID, input.tool)
        if (loopWarning) {
          console.warn(loopWarning)
        }

        // Track consecutive failures
        const failureWarning = detector.trackFailure(input.sessionID, isFailure)
        if (failureWarning) {
          console.warn(failureWarning)
        }

        // Increment call counter and check for L2 trigger
        const { shouldTriggerL2, message } = detector.incrementCallCounter(input.sessionID)
        if (message) {
          console.warn(message)
        }

        // Trigger L2 analysis if threshold reached
        if (shouldTriggerL2 && delegateTask) {
          const summary = detector.getRecentCallsSummary(input.sessionID)
          
          // Fire and forget - don't block on L2 analysis
          delegateTask({
            subagent_type: "observer",
            run_in_background: true,
            prompt: `Analyze the last 20 tool calls for patterns, anomalies, or inefficiencies.\n\n${summary}\n\nLook for:\n- Repeated tool calls that might indicate loops\n- Failure patterns that suggest issues\n- Opportunities to optimize tool usage`,
          }).catch((err) => {
            console.warn(
              `[observer-detector] L2 analysis dispatch failed: ${err instanceof Error ? err.message : String(err)}`
            )
          })
        }
      } catch (err) {
        // Silent fail - don't block execution
        console.warn(
          `[observer-detector] Error during detection: ${err instanceof Error ? err.message : String(err)}`
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
          `[observer-detector] Error during cleanup: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  }
}
