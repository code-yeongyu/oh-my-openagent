import type { BackgroundManager } from "../../features/background-agent"

interface Event {
  type: string
  properties?: Record<string, unknown>
}

interface EventInput {
  event: Event
}

export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async ({ event }: EventInput) => {
    manager.handleEvent(event)
  }

  return {
    event: eventHandler,
  }
}

export type { BackgroundNotificationHookConfig } from "./types"
