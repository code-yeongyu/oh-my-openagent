export type ItemAttributes = { readonly cdat: number; readonly mdat: number }
export type ApprovalEntry = ItemAttributes & { readonly value: string; readonly readStartedAt: number }
export type ApprovalAnswer = { readonly kind: "approved"; readonly value: string; readonly attributes: ItemAttributes } | { readonly kind: "denied" } | { readonly kind: "missing" }

export type ApprovalClock = { readonly nowSeconds: () => number; readonly sleepMs: (ms: number) => Promise<void> }
export const systemClock: ApprovalClock = { nowSeconds: () => Date.now() / 1_000, sleepMs: ms => Bun.sleep(ms) }

/**
 * A cached `approve` answer serves a read only while `<A>` is exactly the item that answer read: equal `cdat` and `mdat`,
 * and `floor(mdat) < floor(readStartedAt)` so any write after the approval read started (which lands in that second or
 * later) invalidates it. A clock that went backwards since then drops the entry (design 3.5).
 */
export function isEntryValid(entry: ApprovalEntry, current: ItemAttributes, nowSeconds: number): boolean {
  if (nowSeconds < entry.readStartedAt) return false
  return current.cdat === entry.cdat && current.mdat === entry.mdat && Math.floor(current.mdat) < Math.floor(entry.readStartedAt)
}

export type ApprovalCache = ReturnType<typeof createApprovalCache>

/**
 * One cache per process (design 3.2 step 3; addendum rows 12, 13, 22, 23): the validated answer, the one in-flight
 * `approve` every caller attaches to, and a remembered "Deny" that only background paths honor.
 */
export function createApprovalCache(clock: ApprovalClock = systemClock) {
  let entry: ApprovalEntry | null = null
  let deniedForBackground = false
  let pending: Promise<ApprovalAnswer> | null = null

  return {
    consume(current: ItemAttributes): string | null {
      if (entry === null) return null
      if (!isEntryValid(entry, current, clock.nowSeconds())) {
        entry = null
        return null
      }
      return entry.value
    },

    deniedForBackground: () => deniedForBackground,

    /**
     * Runs `approve` at most once at a time per process: later callers attach to the pending answer instead of opening a
     * second dialog, and a late answer still fills the cache after a caller's bounded wait expired (3.2 step 4).
     */
    approve(run: () => Promise<ApprovalAnswer>): Promise<ApprovalAnswer> {
      if (pending !== null) return pending
      const readStartedAt = clock.nowSeconds()
      const started = run().then(answer => {
        if (answer.kind === "approved") {
          entry = { value: answer.value, ...answer.attributes, readStartedAt }
          deniedForBackground = false
        } else if (answer.kind === "denied") deniedForBackground = true
        return answer
      })
      const settled = () => {
        if (pending === started) pending = null
      }
      started.then(settled, settled)
      pending = started
      return started
    },

    /**
     * After this process wrote a non-owned item under the session lock, keep serving it: take the written value, hold
     * the lock until the clock has left the write's second, then re-stamp from a fresh attribute read. Any later foreign
     * write lands in a later second and fails validation (3.2 step 3, "This process's own writes keep it valid").
     */
    async afterOwnWrite(value: string, readAttributes: () => Promise<ItemAttributes | null>): Promise<void> {
      if (entry === null) return
      const written = await readAttributes()
      if (written === null) {
        entry = null
        return
      }
      while (Math.floor(clock.nowSeconds()) <= Math.floor(written.mdat)) {
        await clock.sleepMs(Math.max(1, Math.ceil((Math.floor(written.mdat) + 1 - clock.nowSeconds()) * 1_000)))
      }
      const readStartedAt = clock.nowSeconds()
      const fresh = await readAttributes()
      entry = fresh === null ? null : { value, ...fresh, readStartedAt }
    },

    drop(): void {
      entry = null
    },
  }
}

let processCache: ApprovalCache | undefined
export const processApprovalCache = (): ApprovalCache => (processCache ??= createApprovalCache())
