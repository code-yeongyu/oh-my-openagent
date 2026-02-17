import type { HookName } from "../config"
import type { HookCadenceTracker } from "./hook-cadence-tracker"

/**
 * Wraps a hook's handlers with cadence gating logic.
 * 
 * For each hook handler, checks if the hook should fire based on:
 * 1. The configured cadence for this hook
 * 2. The current turn count for this session
 * 
 * If the hook should not fire on this turn, the handler is skipped.
 * Session cleanup events always pass through to maintain state consistency.
 */

type HookHandler = (...args: any[]) => Promise<void> | void

interface HookHandlers {
  [key: string]: HookHandler
}

interface ToolExecuteInput {
  sessionID: string
  [key: string]: unknown
}

interface EventInput {
  event: {
    type: string
    [key: string]: unknown
  }
}

export function wrapHookWithCadence<T extends HookHandlers>(
  hookName: HookName,
  hook: T,
  cadenceTracker: HookCadenceTracker
): T {
  const wrappedHook: any = {}

  for (const [handlerName, handler] of Object.entries(hook)) {
    if (handlerName === "event") {
      // Special handling for event handlers
      wrappedHook[handlerName] = async (input: EventInput) => {
        const eventType = input.event.type

        // Always allow session cleanup events through
        if (eventType === "session.deleted" || eventType === "session.compacted") {
          // Extract sessionID and clean up cadence tracker
          const props = input.event.properties as Record<string, unknown> | undefined
          let sessionID: string | undefined

          if (eventType === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined
            sessionID = sessionInfo?.id
          } else if (eventType === "session.compacted") {
            sessionID = (props?.sessionID ??
              (props?.info as { id?: string } | undefined)?.id) as string | undefined
          }

          if (sessionID) {
            cadenceTracker.cleanupSession(sessionID)
          }

          return handler(input)
        }

        // For other events, check cadence
        // Note: Most events don't have sessionID, so we can't gate them
        // This is acceptable as most cadence-controlled hooks use tool.execute.after
        return handler(input)
      }
    } else if (handlerName === "tool.execute.after" || handlerName === "tool.execute.before") {
      // Gate tool execution handlers based on cadence
      wrappedHook[handlerName] = async (input: ToolExecuteInput, ...rest: any[]) => {
        const { sessionID } = input

        // Check if hook should fire on this turn
        if (!cadenceTracker.shouldFire(hookName, sessionID)) {
          return // Skip this turn
        }

        return handler(input, ...rest)
      }
    } else {
      // Pass through other handlers unchanged
      wrappedHook[handlerName] = handler
    }
  }

  return wrappedHook as T
}
