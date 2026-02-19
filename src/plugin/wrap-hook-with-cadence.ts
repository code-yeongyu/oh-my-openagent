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

export function wrapHookWithCadence<T extends Record<string, unknown>>(
  hookName: HookName,
  hook: T,
  cadenceTracker: HookCadenceTracker
): T {
  const wrappedHook: any = {}

  for (const [handlerName, handler] of Object.entries(hook)) {
    // Skip non-function properties (copy them directly later)
    if (typeof handler !== "function") {
      wrappedHook[handlerName] = handler
      continue
    }
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

        // Event handlers are not cadence-gated: most events lack sessionID,
        // and events often represent state transitions that must not be skipped.
        // Cadence gating applies only to tool.execute.before/after handlers.
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

  // Copy any non-handler properties (methods, state) from the original hook
  for (const [key, value] of Object.entries(hook)) {
    if (!(key in wrappedHook)) {
      wrappedHook[key] = value
    }
  }

  return wrappedHook as T
}
