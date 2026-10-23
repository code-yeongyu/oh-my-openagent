import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { maxSendMs, postWithRetry, type OtlpFetch } from "./otlp-http"
import {
  claimBatch,
  deleteFile,
  dropFile,
  oldestSealedBatches,
  quarantineFile,
  releaseClaim,
  renewClaim,
  type SpoolContext,
} from "./otlp-spool-dir"
import { spoolRequest } from "./otlp-spool-file"
import type { TelemetryDiagnosticEvent } from "./types"


export type BatchSenderInput = {
  readonly ctx: SpoolContext
  readonly endpoint: string
  readonly ingestKey: string
  readonly fetch: OtlpFetch
  readonly requestTimeoutMs: number
  readonly leaseRenewIntervalMs: number
  readonly sleep: (ms: number, abort: AbortSignal) => Promise<void>
  readonly random: () => number
  readonly consent: () => boolean
  readonly onAccepted: () => void
  readonly report: (event: TelemetryDiagnosticEvent, error?: unknown) => void
}

/**
 * Sends sealed batches oldest first, one file per request, each under a renamed claim with a lease.
 * A file whose send must be retried later is skipped until the next flush, so an outage never spins.
 */
export class BatchSender {
  readonly #input: BatchSenderInput
  readonly #abort = new AbortController()
  readonly #deferred = new Set<string>()
  #pumping: Promise<void> | null = null
  #rerun = false
  #inFlight: string | undefined
  #claiming: Promise<unknown> | undefined
  #stopped = false

  constructor(input: BatchSenderInput) {
    this.#input = input
  }

  newCycle(): void {
    this.#deferred.clear()
  }

  pump(): Promise<void> {
    if (this.#pumping !== null) {
      this.#rerun = true
      return this.#pumping
    }
    this.#pumping = (async () => {
      do {
        this.#rerun = false
        await this.#pass()
      } while (this.#rerun && !this.#stopped)
    })().finally(() => {
      this.#pumping = null
    })
    return this.#pumping
  }

  /**
   * Releases the in-flight claim, and waits (no longer than `grace`) for a claim rename still in
   * progress so the pass can release that one too instead of leaving it claimed until its lease ends.
   */
  async stop(grace: Promise<void>): Promise<void> {
    this.#stopped = true
    this.#abort.abort()
    const inFlight = this.#inFlight
    if (inFlight !== undefined) this.#release(inFlight)
    const claiming = this.#claiming
    if (claiming !== undefined) await Promise.race([claiming.then(() => undefined, () => undefined), grace])
  }

  #release(claimed: string): void {
    try {
      releaseClaim(this.#input.ctx, claimed)
    } catch (error) {
      this.#input.report("telemetry_otlp_send_failed", error)
    }
  }

  async #pass(): Promise<void> {
    const ctx = this.#input.ctx
    // One directory listing serves a whole run of sends; the spool is re-listed only once that run
    // is used up, so a pass over n files costs O(n) directory reads instead of one per file.
    let pending: ReturnType<typeof oldestSealedBatches> = []
    while (!this.#stopped && this.#input.consent()) {
      if (pending.length === 0) {
        try {
          pending = oldestSealedBatches(ctx.dir).filter((entry) => !this.#deferred.has(entry.batchId))
        } catch (error) {
          this.#input.report("telemetry_spool_sweep_failed", error)
          return
        }
      }
      const next = pending.shift()
      if (next === undefined) return
      this.#deferred.add(next.batchId)
      // A claim that completes after stop() is released before the promise stop() waits on settles.
      const claiming = claimBatch(ctx, next).then((claimed) => {
        if (claimed === null || !this.#stopped) return claimed
        this.#release(claimed)
        return null
      })
      this.#claiming = claiming
      let claimed: string | null
      try {
        claimed = await claiming
      } catch (error) {
        // The batch keeps its name (or its lease runs out) and a later pass retries it; the pump never rejects.
        this.#input.report("telemetry_otlp_send_failed", error)
        claimed = null
      } finally {
        this.#claiming = undefined
      }
      if (claimed !== null) await this.#send(claimed)
    }
  }

  async #send(claimed: string): Promise<void> {
    const ctx = this.#input.ctx
    this.#inFlight = claimed
    // Past the longest possible send, the lease is left to expire so another process can take over.
    const deadlineMs = ctx.nowMs() + maxSendMs(this.#input.requestTimeoutMs)
    const renew = setInterval(() => {
      if (ctx.nowMs() > deadlineMs) return
      const current = this.#inFlight
      // A timer has no caller to reject to: an error here would be an uncaught exception in the host.
      try {
        const renewed = current === undefined ? null : renewClaim(ctx, current)
        if (renewed !== null) this.#inFlight = renewed
      } catch (error) {
        this.#input.report("telemetry_spool_write_failed", error)
      }
    }, this.#input.leaseRenewIntervalMs)
    renew.unref?.()
    try {
      const request = spoolRequest(new Uint8Array(await readFile(join(ctx.dir, claimed))))
      if (request.kind === "corrupt") {
        quarantineFile(ctx, claimed)
        return
      }
      const outcome = await postWithRetry({
        fetch: this.#input.fetch,
        sleep: this.#input.sleep,
        random: this.#input.random,
        endpoint: this.#input.endpoint,
        ingestKey: this.#input.ingestKey,
        abort: this.#abort.signal,
        requestTimeoutMs: this.#input.requestTimeoutMs,
      }, request.signal, request.body)
      const current = this.#inFlight ?? claimed
      if (outcome.kind === "accepted") {
        deleteFile(ctx.dir, current)
        this.#input.onAccepted()
        if (outcome.partial !== undefined && outcome.partial.rejected > 0) {
          this.#input.report("telemetry_otlp_partial_success", new Error(outcome.partial.message))
        }
      } else if (outcome.kind === "rejected") {
        dropFile(ctx, current, "rejected")
      } else if (!this.#stopped) {
        releaseClaim(ctx, current)
        if (outcome.kind === "retry_later") this.#input.report("telemetry_otlp_send_failed")
      }
    } catch (error) {
      // After stop() the claim has already been released, so a read that lost the file is expected.
      if (this.#stopped) return
      this.#input.report("telemetry_otlp_send_failed", error)
      this.#release(this.#inFlight ?? claimed)
    } finally {
      clearInterval(renew)
      this.#inFlight = undefined
    }
  }
}
