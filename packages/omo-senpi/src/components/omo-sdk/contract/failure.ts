import type { OmoCode } from "./codes"

// The root's one failure shape and its two ok shapes (first-party design 4.4). The remote module's three extra fields
// are first-class and optional, carried with their values unchanged, so the conversion to and from its flat failure is
// lossless.
export type OmoFailure = {
  readonly kind: "error"
  readonly error: {
    readonly code: OmoCode
    readonly message: string
    readonly next_action: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly uncertain?: boolean
    readonly command_id?: string
    readonly partial?: unknown
  }
}

export type OmoValue<T> = { readonly kind: "ok"; readonly value: T } | OmoFailure

/** A thread call answers the thread contract's own ok branch, which receipts persist and replays print. */
export type OmoThreadAnswer<Result> = Exclude<Result, { readonly kind: "error" | "refused" }> | OmoFailure

/** One terminal event ends a stream: the outcome, a failure, or `cancelled` after `stop()`. Nothing throws from `next()`. */
export type OmoStreamEvent<Event, Outcome> =
  | { readonly kind: "event"; readonly event: Event }
  | { readonly kind: "end"; readonly outcome: Outcome }
  | { readonly kind: "end"; readonly cancelled: true }
  | { readonly kind: "end"; readonly failure: OmoFailure["error"] }

export type OmoStream<Event, Outcome> = AsyncIterable<OmoStreamEvent<Event, Outcome>> & { readonly stop: () => void }
