import { isHardFailure } from "./error-classifier"
import type { FallbackState } from "./types"

/**
 * Sticky-on-pinned-model gate: while the session is still on the user's
 * originally-resolved model (`currentModel === originalModel`), defer to
 * opencode's own internal retry on TRANSIENT errors and only advance the
 * chain on HARD failures. Once the chain has advanced once, the user's
 * pinned choice is already lost and the existing aggressive walk runs
 * unchanged.
 *
 * This keeps a user-pinned `claude-sonnet-4.6` from rapidly oscillating to
 * chain[0]=`kimi-k2.6` -> chain[1]=`gpt-5.5` -> ... when the provider
 * surfaces transient rate-limit / 5xx / "retrying in" signals that opencode
 * already retries internally.
 */
export function shouldDeferTransientOnPinnedModel(
  state: Pick<FallbackState, "currentModel" | "originalModel">,
  error: unknown,
): boolean {
  return state.currentModel === state.originalModel && !isHardFailure(error)
}
