import type { EventState } from "./event-state"
import { closeThinkBlock, openThinkBlock } from "./output-renderer"

export function ensureThinkBlockOpen(state: EventState): void {
  if (state.inThinkBlock) return
  openThinkBlock()
  state.inThinkBlock = true
  state.hasPrintedThinkingLine = false
  state.thinkingAtLineStart = false
}

export function closeThinkBlockIfNeeded(state: EventState): void {
  if (!state.inThinkBlock) return
  closeThinkBlock()
  state.inThinkBlock = false
  state.lastThinkingLineWidth = 0
  state.lastThinkingSummary = ""
  state.thinkingAtLineStart = false
}
