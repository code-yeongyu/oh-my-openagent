// The sync engine: one cycle for both directions (sync-design §5). Triggers - startup, an
// advertised head beyond the applied cursor, a 10 s poll while the event stream is down, a local
// commit after a 2 s debounce - only request a cycle; cycles run one at a time. A cycle resumes any
// journaled work, receives outside the lock, captures and applies under it, then pushes outside it;
// a stale base receives first and retries.

import { advance, applyVerified, capture } from "./apply"
import type { EngineDeps } from "./engine-deps"
import { describeSyncFailure, isFailureShown, type SyncFailure } from "./failure"
import { type EngineState, SyncJournal } from "./journal"
import { push, staleBackoffMs } from "./push"
import type { RefusalCode } from "./ports"
import { receive } from "./receive"

export { CrashInjected, type EngineFault, INBOUND_POINTS, OUTBOUND_POINTS } from "./engine-deps"
export type { SyncFailure, SyncFailureKind } from "./failure"

export const POLL_MS = 10_000
export const LOCAL_DEBOUNCE_MS = 2_000
const PUSH_ATTEMPTS = 3

export type EngineStatus =
  | { readonly kind: "never_synced" }
  | { readonly kind: "synced"; readonly at: number; readonly updatedWhileOffline: number }
  | { readonly kind: "paused"; readonly seq: number; readonly code: RefusalCode }
  | { readonly kind: "failing"; readonly failure: SyncFailure; readonly since: number; readonly attempts: number }

interface Failing {
  readonly failure: SyncFailure
  readonly since: number
  readonly attempts: number
}

export interface CycleReport {
  readonly applied: number
  readonly refused: number
  readonly pushed: boolean
  readonly snapshot: number | null
}

export class SyncEngine {
  readonly journal: SyncJournal
  cyclesRun = 0
  private loaded = false
  private running: Promise<CycleReport> | null = null
  /** A local commit, poll or startup request arrived while a cycle ran: it always gets its own cycle. */
  private rerun = false
  /**
   * A stream event arrived while a cycle ran. It reruns only when its head is still beyond what the finished
   * cycle applied, so the device's own pushed head echoed back by the per-user stream starts no extra cycle.
   */
  private rerunOnEvent = false
  /** Set by stop(): no new cycle starts after it, so close() can release the device lease safely. */
  private stopped = false
  private eventHead = 0
  private appliedMirror = 0
  private waiters: { readonly resolve: (report: CycleReport) => void; readonly reject: (error: unknown) => void }[] = []
  private unsubscribe: (() => void) | null = null
  private cancelPoll: (() => void) | null = null
  private cancelDebounce: (() => void) | null = null
  private failing: Failing | null = null
  /** The failure a UI shows: set once a failure crosses its visibility threshold, cleared only by a successful cycle. */
  private shown: Failing | null = null

  constructor(private readonly deps: EngineDeps) {
    this.journal = new SyncJournal(deps.repo.gitDir)
  }

  state(): Promise<EngineState> {
    return this.journal.state()
  }

  /** What a UI shows: a shown failure until a cycle succeeds, paused at a refused entry, else the last successful sync. */
  async status(): Promise<EngineStatus> {
    // Failing outranks paused on purpose: while no cycle completes nothing moves at all, and a paused refusal shows again after the first good cycle.
    if (this.shown !== null) return { kind: "failing", ...this.shown }
    const s = await this.journal.state()
    if (s.paused !== null) return { kind: "paused", seq: s.paused.seq, code: s.paused.code }
    if (s.lastSyncedAt === null) return { kind: "never_synced" }
    return { kind: "synced", at: s.lastSyncedAt, updatedWhileOffline: s.updatedWhileOffline }
  }

  start(): void {
    this.stopped = false
    this.unsubscribe = this.deps.transport.subscribe({
      onAdvanced: (head) => {
        this.eventHead = Math.max(this.eventHead, head)
        if (head > this.appliedMirror) this.request("event")
      },
      onConnected: (connected) => (connected ? this.stopPolling() : this.poll()),
    })
    this.request()
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.stopPolling()
    this.cancelDebounce?.()
    this.stopped = true
    this.rerun = false
    this.rerunOnEvent = false
    while (this.running !== null) await this.running.catch(() => undefined)
  }

  notifyLocalCommit(): void {
    this.cancelDebounce?.()
    this.cancelDebounce = this.deps.clock.after(LOCAL_DEBOUNCE_MS, () => {
      this.cancelDebounce = null
      this.request()
    })
  }

  /** The running cycle's outcome, or the next cycle's when none is running: its report, or its failure. */
  nextCycle(): Promise<CycleReport> {
    if (this.running !== null) return this.running
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  runCycle(): Promise<CycleReport> {
    const previous = this.running ?? Promise.resolve(null)
    const run = previous.catch(() => null).then(() => this.cycle())
    this.running = run
    const waiters = this.waiters.splice(0)
    void run.then(
      (report) => {
        const shownBefore = this.shownKey()
        this.failing = null
        this.shown = null
        this.announceIfChanged(shownBefore)
        for (const w of waiters) w.resolve(report)
        if (this.running === run) this.running = null
        const rerun = this.rerun || (this.rerunOnEvent && this.eventHead > this.appliedMirror)
        this.rerun = false
        this.rerunOnEvent = false
        if (rerun) this.request()
      },
      (error: unknown) => {
        const shownBefore = this.shownKey()
        const failure = describeSyncFailure(error)
        const previous = this.failing
        const failing = previous?.failure.kind === failure.kind
          ? { failure, since: previous.since, attempts: previous.attempts + 1 }
          : { failure, since: this.deps.clock.now(), attempts: 1 }
        this.failing = failing
        // A failure below its threshold (an offline blip) never replaces or clears what is shown: only a
        // successful cycle clears a shown failure.
        if (isFailureShown(failing.failure.kind, failing.attempts)) {
          const shown = this.shown
          this.shown = shown !== null && shownBefore === `${failure.kind}\n${failure.action}`
            ? { failure, since: shown.since, attempts: shown.attempts + 1 }
            : failing
        }
        this.announceIfChanged(shownBefore)
        for (const w of waiters) w.reject(error)
        if (this.running === run) this.running = null
        // A request that arrived during the failed cycle still deserves its cycle: nothing it asked for was done.
        const rerun = this.rerun || this.rerunOnEvent
        this.rerun = false
        this.rerunOnEvent = false
        if (rerun) this.request()
      },
    )
    return run
  }

  /** The shown failure's kind and action: a new stranded lock path changes the action, so it is a change too. */
  private shownKey(): string | null {
    return this.shown === null ? null : `${this.shown.failure.kind}\n${this.shown.failure.action}`
  }

  /** Tells the owner when the shown failure appears, changes or clears; a repeat of the same one is silent. */
  private announceIfChanged(shownBefore: string | null): void {
    if (this.shownKey() === shownBefore) return
    try {
      this.deps.onStatusChange?.()
    } catch (error) {
      this.deps.log?.(`sync status listener failed: ${error instanceof Error ? error.message : "a non-Error value was thrown"}`)
    }
  }

  private request(trigger: "always" | "event" = "always"): void {
    if (this.stopped) return
    if (this.running !== null) {
      if (trigger === "event") this.rerunOnEvent = true
      else this.rerun = true
      return
    }
    void this.runCycle().catch((error: unknown) => this.deps.log?.(`sync cycle failed: ${String(error)}`))
  }

  /**
   * A journal names the device peer it was created under. One from another peer arrived with a
   * copied repo: its pending ops are that device's to push, so it is retired, never resumed.
   */
  private async claimJournal(): Promise<void> {
    const peer = this.deps.store.peer()
    const owner = (await this.journal.state()).peer
    if (owner !== null && owner !== peer) {
      this.deps.log?.(`sync: journal belongs to peer ${owner}, this device is ${peer}; retiring it`)
      await this.journal.retire()
    }
    if (owner !== peer) await this.journal.updateState({ peer })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.deps.clock.after(ms, resolve))
  }

  private poll(): void {
    this.stopPolling()
    this.cancelPoll = this.deps.clock.after(POLL_MS, () => {
      this.request()
      this.poll()
    })
  }

  private stopPolling(): void {
    this.cancelPoll?.()
    this.cancelPoll = null
  }

  private async cycle(): Promise<CycleReport> {
    const { deps, journal } = this
    if (!this.loaded) {
      await deps.store.load()
      await this.claimJournal()
      this.loaded = true
    }
    const before = await journal.updateState({ eventHead: Math.max(this.eventHead, (await journal.state()).eventHead) })
    if (before.cycle !== null) {
      const resumed = before.cycle
      await deps.lock.withLock(async () => {
        // A cycle resumed at merged re-renders its keys over the working files: capture any edit made
        // since the crash first, so it merges into the doc instead of being overwritten.
        if (resumed.stage === "merged") await capture(deps, journal, resumed)
        await advance(deps, journal, resumed)
      })
    }
    let applied = 0
    let memories = 0
    let refused = 0
    let snapshot: number | null = null
    const inbound = async () => {
      const got = await receive(deps, journal)
      refused += got.refused
      snapshot = got.snapshot ?? snapshot
      const done = await deps.lock.withLock(async () => {
        await capture(deps, journal)
        return applyVerified(deps, journal)
      })
      applied += done.batches
      memories += done.memories
    }
    await inbound()
    let pushed = false
    for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt += 1) {
      const outcome = await push(deps, journal, deps.batchBytes)
      if (outcome !== "stale") {
        pushed = outcome === "pushed"
        break
      }
      await this.sleep(staleBackoffMs(attempt, deps.random))
      await inbound()
    }
    if (refused === 0) await journal.updateState({ lastSyncedAt: deps.clock.now(), updatedWhileOffline: memories })
    this.appliedMirror = (await journal.state()).applied
    this.cyclesRun += 1
    return { applied, refused, pushed, snapshot }
  }
}
