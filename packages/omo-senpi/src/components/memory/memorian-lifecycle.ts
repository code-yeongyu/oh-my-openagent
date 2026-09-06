import type { ChildHandle } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"

export async function abortAndDispose(handle: ChildHandle, logger: ComponentLogger | undefined, runId: string): Promise<void> {
  try {
    await handle.abort()
  } catch (error) {
    logger?.warn("memorian gate abort failed", { error: describe(error), runId })
  } finally {
    handle.dispose()
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
