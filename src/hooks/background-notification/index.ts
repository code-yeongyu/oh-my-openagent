import type { BackgroundManager } from "../../features/background-agent"

interface Event {
  type: string
  properties?: Record<string, unknown>
}

interface EventInput {
  event: Event
}

/**
 * Background notification hook - handles event routing to BackgroundManager.
 * 
 * Notifications are now delivered directly via session.prompt({ noReply }) 
 * from the manager, so this hook only needs to handle event routing.
 */
export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async ({ event }: EventInput) => {
    manager.handleEvent(event)
  }

  return {
    event: eventHandler,
  }
}

export type { BackgroundNotificationHookConfig } from "./types"
