import type { McbToolAvailability } from "./types"
import { getMcbAvailability, markMcbUnavailable } from "./availability"

export type McbOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; degraded: true }

export async function withMcbFallback<T>(
  operation: () => Promise<T>,
  _fallbackValue: T,
  toolName?: keyof McbToolAvailability,
): Promise<McbOperationResult<T>> {
  const status = getMcbAvailability()

  if (!status.available) {
    return { success: false, error: "MCB unavailable", degraded: true }
  }

  if (toolName && !status.tools[toolName]) {
    return { success: false, error: `MCB tool ${toolName} unavailable`, degraded: true }
  }

  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (toolName) {
      markMcbUnavailable(toolName)
    }
    return { success: false, error: message, degraded: true }
  }
}
