/**
 * The `sync.batch.rejected` local signal (todo 13): one counter and one content-free local
 * log line per refused entry. The log line carries the reason code only - never an account,
 * seq, digest, author or any byte of the refused object.
 */
export type RejectionCounter = {
  readonly count: () => number
  readonly lastEvent: () => string
  readonly record: (reason: string) => void
}

export const createRejectionCounter = (log?: (line: string) => void): RejectionCounter => {
  let rejected = 0
  let last = ""
  return {
    count: () => rejected,
    lastEvent: () => last,
    record: (reason) => {
      rejected += 1
      last = `sync.batch.rejected ${reason}`
      log?.(last)
    },
  }
}
