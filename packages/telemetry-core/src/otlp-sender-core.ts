import { context } from "@opentelemetry/api"

import { createTelemetryProviders, type TelemetryProviders } from "./otel-providers"
import { BatchSender } from "./otlp-batch-sender"
import { DEFAULT_REQUEST_TIMEOUT_MS } from "./otlp-http"
import { resolveOtlpEndpoint, type WireAttributes } from "./otlp-config"
import { safeConsent } from "./otlp-gate"
import {
  createBatchId,
  SPOOL_CAP_BYTES,
  SPOOL_MAX_AGE_MS,
  sweepSpool,
  type DropReason,
  type SpoolContext,
} from "./otlp-spool-dir"
import { SpoolCap } from "./otlp-spool-cap"
import { purgeReport, purgeSpool } from "./otlp-spool-purge"
import { abortableSleep, delay } from "./otlp-sleep"
import type { CreateOtlpTelemetryTransportInput, OtlpTelemetryTransport } from "./otlp-transport-types"
import type { SpoolWriter } from "./otlp-wal"
import type { TelemetryCaptureMessage, TelemetryDiagnosticEvent } from "./types"

const SEAL_BYTES = 200 * 1024
const LEASE_RENEW_INTERVAL_MS = 60_000
const SHUTDOWN_CLEANUP_RESERVE_MS = 200
const DROP_REASONS: readonly DropReason[] = ["evicted", "expired", "rejected", "corrupt", "write_failed"]

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/**
 * The sender itself, with no opt-out check of its own. Only `startOtlpTransport` (otlp-sender.ts), which
 * checks every opt-out and consent first, loads this module; tests drive it directly.
 */
export function createOtlpSender(input: CreateOtlpTelemetryTransportInput): OtlpTelemetryTransport {
  return new OtlpSender(input, resolveOtlpEndpoint(input.env ?? process.env, input.endpoint)).transport
}

class OtlpSender {
  readonly transport: OtlpTelemetryTransport
  readonly #input: CreateOtlpTelemetryTransportInput
  readonly #ctx: SpoolContext
  readonly #providers: TelemetryProviders
  readonly #consent: () => boolean
  readonly #batches: BatchSender
  readonly #cap: SpoolCap
  readonly #unreported: Record<DropReason, number> = { evicted: 0, expired: 0, rejected: 0, corrupt: 0, write_failed: 0 }
  readonly #timers: ReturnType<typeof setInterval>[] = []
  readonly #started: Promise<void>
  #droppedSince200 = 0
  #stopped = false

  constructor(input: CreateOtlpTelemetryTransportInput, endpoint: string) {
    this.#input = input
    this.#consent = safeConsent(input)
    this.#providers = createTelemetryProviders({
      resource: input.resource,
      scope: input.scope,
      spoolDir: input.spoolDir,
      spans: input.spans,
      ...(input.bootId === undefined ? {} : { bootId: input.bootId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.clock === undefined ? {} : { clock: input.clock }),
      consent: this.#consent,
      onAppended: (writer) => this.#onAppended(writer),
      onWriteError: (error, records) => this.#onWriteError(error, records),
    })
    this.#ctx = {
      dir: input.spoolDir,
      bootId: this.#providers.bootId,
      pid: input.pid ?? process.pid,
      nowMs: input.nowMs ?? Date.now,
      isPidAlive: input.isPidAlive ?? isPidAlive,
      capBytes: input.capBytes ?? SPOOL_CAP_BYTES,
      maxAgeMs: input.maxAgeMs ?? SPOOL_MAX_AGE_MS,
      onLockLeft: (error) => this.#report("telemetry_spool_write_failed", error),
      onDrop: (reason, records) => {
        this.#droppedSince200 += records
        this.#unreported[reason] += records
      },
    }
    this.#cap = new SpoolCap(this.#ctx)
    this.#batches = new BatchSender({
      ctx: this.#ctx,
      endpoint,
      ingestKey: input.ingestKey,
      fetch: input.fetch ?? fetch,
      requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      leaseRenewIntervalMs: input.leaseRenewIntervalMs ?? LEASE_RENEW_INTERVAL_MS,
      sleep: input.sleep ?? abortableSleep,
      random: input.random ?? Math.random,
      consent: this.#consent,
      onAccepted: () => {
        this.#droppedSince200 = 0
      },
      report: (event, error) => this.#report(event, error),
    })
    // The startup sweep + pass runs first; a flush waits for it, so a batch sealed by an early flush is
    // never left behind by a pass that listed the spool before the seal.
    // Settled, never rejected: a failed startup pass is reported once, and later flushes still run.
    this.#started = input.autoStart === false
      ? Promise.resolve()
      : this.#start().catch((error: unknown) => this.#report("telemetry_otlp_send_failed", error))
    this.transport = {
      sampling: { rawTurnRate: 1 },
      tracer: this.#providers.tracer,
      endpoint,
      ready: this.#started,
      capture: (message) => this.#capture(message),
      flush: () => this.#flush(),
      shutdown: () => this.#shutdown(),
      sweep: () => this.#guard("telemetry_spool_sweep_failed", () => sweepSpool(this.#ctx)),
      droppedEvents: () => this.#droppedSince200,
    }
  }

  #start(): Promise<void> {
    const flushTimer = setInterval(() => void this.#flush(), this.#input.flushIntervalMs ?? 10_000)
    const sweepTimer = setInterval(() => {
      this.transport.sweep()
      void this.#batches.pump()
    }, this.#input.sweepIntervalMs ?? 60_000)
    flushTimer.unref?.()
    sweepTimer.unref?.()
    this.#timers.push(flushTimer, sweepTimer)
    return Promise.resolve().then(() => {
      this.transport.sweep()
      return this.#batches.pump()
    })
  }

  #report(event: TelemetryDiagnosticEvent, error?: unknown): void {
    this.#input.diagnostics?.({
      event,
      source: this.#input.source ?? "otlp",
      error,
      errorKind: error === undefined ? undefined : error instanceof Error ? "error" : "non_error",
    })
  }

  /** Records that never reached the spool, or were in an abandoned active file, are a counted loss like any other drop. */
  #onWriteError(error: unknown, records: number): void {
    this.#report("telemetry_spool_write_failed", error)
    this.#ctx.onDrop("write_failed", records)
  }

  #guard(event: TelemetryDiagnosticEvent, run: () => void): void {
    try {
      run()
    } catch (error) {
      this.#report(event, error)
    }
  }

  #emit(name: string, attributes: WireAttributes): void {
    const uid = attributes["log.record.uid"]
    this.#providers.logger.emit({
      eventName: `omo.${name}`,
      attributes: {
        ...attributes,
        "log.record.uid": typeof uid === "string" ? uid : (this.#input.createEventId ?? (() => createBatchId(this.#ctx.nowMs())))(),
      },
      context: context.active(),
    })
  }

  /** Telemetry never throws into the agent loop: a failing projection or emit is diagnosed and dropped. */
  #capture(message: TelemetryCaptureMessage): void {
    if (this.#stopped) return
    this.#guard("telemetry_capture_failed", () => this.#captureUnguarded(message))
  }

  #captureUnguarded(message: TelemetryCaptureMessage): void {
    const properties = message.properties ?? {}
    const project = this.#input.project
    const eventId = properties["event_id"]
    // `session.id` and every other attribute come from the caller's projection (the per-event allowlist).
    // The record's identity keys go last, uid then session, the order the collector's shared fixture pins.
    const { "session.id": session, ...projected } = project(message.event, properties)
    this.#emit(message.event, {
      ...projected,
      ...(typeof eventId === "string" && eventId.length > 0 ? { "log.record.uid": eventId } : {}),
      ...(session === undefined ? {} : { "session.id": session }),
    })
  }

  #onAppended(writer: SpoolWriter): void {
    if (writer.records < (this.#input.flushAt ?? 20) && writer.bytes < SEAL_BYTES) return
    this.#seal(writer)
    void this.#batches.pump()
  }

  #seal(writer: SpoolWriter): void {
    this.#guard("telemetry_spool_write_failed", () => {
      const batchId = createBatchId(this.#ctx.nowMs())
      const bytes = writer.bytes
      if (writer.seal(batchId) === null) return
      this.#cap.sealed(writer.signal, batchId, bytes)
    })
  }

  #reportDrops(): void {
    for (const reason of DROP_REASONS) {
      const count = this.#unreported[reason]
      if (count === 0) continue
      this.#unreported[reason] = 0
      this.#emit("client_dropped", { "omo.dropped.count": count, "omo.dropped.reason": reason })
    }
  }

  /** Consent withdrawn mid-run: close this process's files, then purge the whole spool. */
  #purge(): void {
    this.#guard("telemetry_spool_write_failed", () => {
      this.#providers.logWriter.discard()
      this.#providers.spanWriter.discard()
      const report = purgeReport(this.#input.diagnostics, this.#input.source ?? "otlp")
      if (purgeSpool(this.#ctx.dir, this.#input.spoolRoot, report) === "refused") this.#report("telemetry_spool_purge_refused")
    })
  }

  async #flush(): Promise<void> {
    if (this.#stopped) return
    if (!this.#consent()) {
      this.#purge()
      return
    }
    await this.#started
    if (this.#stopped) return
    this.#batches.newCycle()
    this.#reportDrops()
    this.#seal(this.#providers.logWriter)
    this.#seal(this.#providers.spanWriter)
    await this.#batches.pump()
  }

  async #shutdown(): Promise<void> {
    if (this.#stopped) return
    for (const timer of this.#timers) clearInterval(timer)
    // The cap is measured from this call: the deadline is armed before the flush runs, so the
    // flush's synchronous seal and claim work counts against the cap instead of delaying its start,
    // and it fires early enough to leave room for releasing the in-flight claim and closing files.
    const cap = this.#input.shutdownTimeoutMs ?? 2_000
    const flushEnds = delay(Math.max(0, cap - Math.min(SHUTDOWN_CLEANUP_RESERVE_MS, cap / 10)))
    const capEnds = delay(cap)
    await Promise.race([this.#flush(), flushEnds.elapsed])
    this.#stopped = true
    await this.#batches.stop(capEnds.elapsed)
    flushEnds.cancel()
    capEnds.cancel()
    this.#providers.shutdown()
  }
}
