import type { OhMyOpenCodeConfig } from "../../config"
import { createMemoryRecallHook } from "../features/openviking/memory-recall"
import { createSessionCommitHook } from "../features/openviking/session-commit"
import { createSessionCompactionHook } from "../features/openviking/compaction"
import { isOpenVikingEnabled } from "../../config/schema/openviking"

/**
 * Plugin context (simplified for OpenViking integration)
 */
interface PluginContext {
  // Add any context needed by OpenViking hooks
}

/**
 * Create all OpenViking hooks
 * 
 * This function creates and returns all OpenViking hooks if the integration
 * is enabled in the configuration.
 * 
 * @param ctx - Plugin context
 * @param pluginConfig - OMO plugin configuration
 * @returns Object containing all OpenViking hooks, or empty object if disabled
 */
export function createOpenVikingHooks(
  ctx: PluginContext,
  pluginConfig: OhMyOpenCodeConfig
): Record<string, unknown> {
  // Skip if OpenViking is not enabled
  if (!isOpenVikingEnabled(pluginConfig.openviking)) {
    return {}
  }

  const openvikingConfig = pluginConfig.openviking!

  // Create all hooks
  const memoryRecallHook = createMemoryRecallHook({
    openviking: openvikingConfig,
  })

  const sessionCommitHook = createSessionCommitHook({
    openviking: openvikingConfig,
  })

  const sessionCompactionHook = createSessionCompactionHook({
    openviking: openvikingConfig,
  })

  // Combine all hooks
  return {
    ...memoryRecallHook,
    ...sessionCommitHook,
    ...sessionCompactionHook,
  }
}

/**
 * Check if OpenViking hooks should be registered
 */
export function shouldRegisterOpenVikingHooks(
  pluginConfig: OhMyOpenCodeConfig
): boolean {
  return isOpenVikingEnabled(pluginConfig.openviking)
}
