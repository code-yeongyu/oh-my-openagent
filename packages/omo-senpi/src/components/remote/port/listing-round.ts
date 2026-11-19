import type { RemoteListing } from "../../thread/remote/ports"

// An account listing waits on every device (0.5-2 s on a loaded fleet, measured 2026-11-14), and one thread op can read
// it several times (the address book, the remote control, the session host). Calls that overlap share one round, and a
// round that just ended answers the calls of the next moment instead of starting another.
const LISTING_REUSE_MS = 2_000

type ListingRound = {
  /** The account listing: the round in flight, a round that ended under LISTING_REUSE_MS ago, or a new round. */
  readonly listing: () => Promise<RemoteListing>
  /** Drops the kept round and detaches the one in flight: the next read lists again. */
  readonly invalidate: () => void
  /**
   * Wraps a command that changes what devices list, fenced on both sides: rounds before it and rounds that overlap it
   * are never kept, so the next read after it settles lists again.
   */
  readonly fenced: <A extends unknown[], R>(run: (...args: A) => Promise<R>) => (...args: A) => Promise<R>
}

export function createListingRound(listOnce: () => Promise<RemoteListing>, now: () => number): ListingRound {
  let round: Promise<RemoteListing> | undefined
  let kept: { readonly at: number; readonly listing: RemoteListing } | undefined
  // A change on any device (create, open, close, a session command) bumps the generation: a round started before it is
  // neither joined nor kept, so no read after a change is answered by a listing taken before it.
  let generation = 0
  const invalidate = (): void => {
    generation += 1
    kept = undefined
    round = undefined
  }
  const listing = (): Promise<RemoteListing> => {
    if (round !== undefined) return round
    if (kept !== undefined && now() - kept.at < LISTING_REUSE_MS) return Promise.resolve(kept.listing)
    const at = generation
    const started = listOnce().then(
      (listed) => {
        if (at === generation) kept = { at: now(), listing: listed }
        if (round === started) round = undefined
        return listed
      },
      (error: unknown) => {
        if (round === started) round = undefined
        throw error
      },
    )
    round = started
    return started
  }
  const fenced =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      invalidate()
      try {
        return await run(...args)
      } finally {
        invalidate()
      }
    }
  return { listing, invalidate, fenced }
}
