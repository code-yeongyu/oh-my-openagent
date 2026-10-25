// /feedback, /bug and the omo.feedback.* RPCs register in the entry bundle; their core ships as the
// `#omo-feedback-runtime` sidecar, imported on the first report.

import type * as FeedbackRuntime from "./runtime"

export type FeedbackRuntimeModule = Pick<typeof FeedbackRuntime, "createFeedbackCore" | "runFeedbackCommand">
export type FeedbackRuntimeLoader = () => Promise<FeedbackRuntimeModule>

export const FEEDBACK_RUNTIME_ARTIFACT = "extensions/omo-feedback.js"

/** One shared import per process; a failed import is not cached, so the next report retries. */
export function createFeedbackRuntimeLoader(importRuntime: () => Promise<FeedbackRuntimeModule>): FeedbackRuntimeLoader {
  let pending: Promise<FeedbackRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadFeedbackRuntime: FeedbackRuntimeLoader = createFeedbackRuntimeLoader(() => import("#omo-feedback-runtime"))

export function feedbackRuntimeLoadFailure(error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `Feedback is unavailable: the feedback runtime (${FEEDBACK_RUNTIME_ARTIFACT}) failed to load: ${cause}. This build's plugin payload is incomplete; reinstall omo, then start a new session.`
}
