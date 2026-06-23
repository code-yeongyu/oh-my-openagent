export type FeedbackSignal = "POSITIVE" | "NEGATIVE" | "VERY_NEGATIVE"

export const FEEDBACK_SIGNALS: readonly FeedbackSignal[] = [
  "POSITIVE",
  "NEGATIVE",
  "VERY_NEGATIVE",
] as const

export interface FeedbackPayload {
  memory_id: string
  feedback: FeedbackSignal
  feedback_reason?: string
}

export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FeedbackValidationError"
  }
}

export interface FeedbackClient {
  submitFeedback(payload: FeedbackPayload): Promise<void>
}

export function validateFeedbackPayload(payload: FeedbackPayload): void {
  if (!payload.memory_id || payload.memory_id.trim() === "") {
    throw new FeedbackValidationError("Feedback memory_id is required")
  }
  if (!payload.feedback) {
    throw new FeedbackValidationError("Feedback signal is required")
  }
  if (!FEEDBACK_SIGNALS.includes(payload.feedback)) {
    throw new FeedbackValidationError(
      `Invalid feedback signal: ${payload.feedback}. Must be one of ${FEEDBACK_SIGNALS.join(", ")}`,
    )
  }
  if (payload.feedback_reason !== undefined && payload.feedback_reason.length > 1000) {
    throw new FeedbackValidationError(
      `Feedback reason exceeds 1000 characters (got ${payload.feedback_reason.length})`,
    )
  }
}

export async function submitFeedback(
  client: FeedbackClient,
  payload: FeedbackPayload,
): Promise<void> {
  validateFeedbackPayload(payload)
  await client.submitFeedback(payload)
}

export function isNegativeSignal(signal: FeedbackSignal): boolean {
  return signal === "NEGATIVE" || signal === "VERY_NEGATIVE"
}

export function aggregateFeedbackScore(signals: FeedbackSignal[]): number {
  if (signals.length === 0) return 0
  const scores = signals.map((s) => {
    if (s === "POSITIVE") return 1
    if (s === "NEGATIVE") return -1
    return -2
  })
  const sum = scores.reduce((a, b) => a + b, 0)
  return sum / signals.length
}
