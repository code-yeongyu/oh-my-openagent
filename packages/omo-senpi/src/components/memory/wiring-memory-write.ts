import type { SenpiExtensionAPI } from "../../extension/types"
import { refreshMemoryStatus } from "./status"
import { isRecord, readUi, sessionIdFrom } from "./wiring-context"
import type { MemoryWiringOptions } from "./wiring-types"
import { MEMORY_APPLY_PATCH_TOOL_NAME, MEMORY_TOOL_NAME } from "./tools"

export function registerMemoryWriteListener(
  pi: SenpiExtensionAPI,
  options: MemoryWiringOptions,
  onMemoryWrite?: (sessionId: string) => void | Promise<void>,
): void {
  const refreshStatus = options.refreshStatus ?? refreshMemoryStatus
  pi.on("tool_result", async (payload: unknown, eventCtx: unknown) => {
    if (!isMemoryToolResult(payload)) return
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined) return
    const state = options.sessions.get(sessionId)
    if (state?.context === undefined) return
    // The rpc snapshot follows every successful write; only the footer honors the once-only latch.
    await onMemoryWrite?.(sessionId)
    if (state.memoryStatusAttempted === true) return
    const ui = readUi(eventCtx)
    if (ui === undefined) return
    state.memoryStatusAttempted = true
    const settings = options.loadConfig({ cwd: options.cwd() }).config.memory
    try {
      const result = await refreshStatus({
        context: state.context,
        ui,
        compileWarnTokens: settings?.compile_warn_tokens ?? 30_000,
        alreadyNotified: false,
        checkAdvisory: false,
        sessionId,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
      state.memoryStatusAttempted = result.footerShown
    } catch (error) {
      state.memoryStatusAttempted = false
      throw error
    }
  })
}

function isMemoryToolResult(value: unknown): boolean {
  if (
    !isRecord(value)
    || value.type !== "tool_result"
    || value.isError === true
    || typeof value.toolName !== "string"
  ) return false
  return matchesToolName(value.toolName, MEMORY_TOOL_NAME)
    || matchesToolName(value.toolName, MEMORY_APPLY_PATCH_TOOL_NAME)
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_")
  const target = expected.trim().toLowerCase().replaceAll("-", "_")
  return normalized === target || normalized.endsWith(`_${target}`)
}
