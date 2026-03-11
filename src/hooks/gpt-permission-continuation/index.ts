import type { PluginInput } from "@opencode-ai/plugin"

import { createGptPermissionContinuationHandler } from "./handler"
import { createSessionStateStore } from "./session-state"

export type GptPermissionContinuationHook = {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  wasRecentlyInjected: (sessionID: string) => boolean
}

export function createGptPermissionContinuationHook(
  ctx: PluginInput,
  options?: {
    isContinuationStopped?: (sessionID: string) => boolean
  },
): GptPermissionContinuationHook {
  const sessionStateStore = createSessionStateStore()

  return {
    handler: createGptPermissionContinuationHandler({
      ctx,
      sessionStateStore,
      isContinuationStopped: options?.isContinuationStopped,
    }),
    wasRecentlyInjected(sessionID: string): boolean {
      return sessionStateStore.wasRecentlyInjected(sessionID, 5_000)
    },
  }
}
