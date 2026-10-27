import type {
  TelemetryCaptureMessage,
  TelemetryDiagnosticInput,
  TelemetryTransport,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { createConsentGatedFetch } from "@oh-my-opencode/telemetry-core/injected"

type PostHogRuntime = { readonly createDefaultPostHogTransport: TelemetryTransportFactory }
type LazyPostHogOptions = {
  readonly load?: () => Promise<PostHogRuntime>
  readonly loadOtlp?: (message: TelemetryCaptureMessage) => Promise<TelemetryTransport | null>
  readonly consent?: () => boolean
  readonly timeoutMs?: number
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly source?: string
  readonly now?: () => number
}

const MAX_PENDING_CAPTURES = 256
const IMPORT_BACKOFF_MS = 60_000

// One successful import per process, but a missing/broken sidecar can be retried.
let runtime: Promise<PostHogRuntime> | undefined
function loadRuntime(): Promise<PostHogRuntime> {
  runtime ??= import("#omo-telemetry-posthog-runtime").catch((error: unknown) => {
    runtime = undefined
    throw error
  })
  return runtime
}

export function createLazyPostHogTransportFactory(input: LazyPostHogOptions = {}): TelemetryTransportFactory {
  const now = input.now ?? Date.now
  const report = (event: TelemetryDiagnosticInput["event"], error?: unknown, count?: number): void => {
    input.diagnostics?.({
      event, source: input.source ?? "omo-telemetry-posthog", error, count,
      errorKind: error === undefined ? undefined : error instanceof Error ? "error" : "non_error",
    })
  }
  let loaded: PostHogRuntime | undefined
  let importing: Promise<PostHogRuntime | undefined> | undefined
  let retryAt = 0
  const importRuntime = (): Promise<PostHogRuntime | undefined> => {
    if (loaded !== undefined) return Promise.resolve(loaded)
    if (now() < retryAt) return Promise.resolve(undefined)
    importing ??= Promise.resolve().then(input.load ?? loadRuntime).then(module => {
      loaded = module
      return module
    }).catch((error: unknown) => {
      retryAt = now() + IMPORT_BACKOFF_MS
      report("telemetry_posthog_import_failed", new Error(
        "PostHog telemetry sidecar could not load; buffered events will retry after 60 seconds",
        { cause: error },
      ))
      return undefined
    }).finally(() => { importing = undefined })
    return importing
  }
  return (apiKey, options) => {
    if (input.consent !== undefined) {
      options = {
        ...options,
        fetch: createConsentGatedFetch({
          isSendAllowed: input.consent,
          onDropped: count => input.diagnostics?.({
            event: "telemetry_events_dropped_by_consent", source: input.source ?? "omo-telemetry", count,
          }),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }),
      }
    }
    let transport: TelemetryTransport | undefined
    let loading: Promise<TelemetryTransport | undefined> | undefined
    const queued: TelemetryCaptureMessage[] = []
    let dropped = 0
    const reportDropped = (): void => {
      if (dropped === 0) return
      report("telemetry_buffer_overflow", undefined, dropped)
      dropped = 0
    }
    const forward = (target: TelemetryTransport, message: TelemetryCaptureMessage): void => {
      try {
        target.capture(message)
      } catch (error) {
        report("telemetry_capture_failed", error)
      }
    }
    const load = (): Promise<TelemetryTransport | undefined> => {
      if (transport !== undefined) return Promise.resolve(transport)
      loading ??= (async () => {
        const module = await importRuntime()
        if (module === undefined) return undefined
        try {
          transport = module.createDefaultPostHogTransport(apiKey, options)
        } catch (error) {
          report("telemetry_posthog_init_failed", error)
          return undefined
        }
        for (const message of queued.splice(0)) forward(transport, message)
        return transport
      })().finally(() => { loading = undefined })
      return loading
    }
    const posthog: TelemetryTransport = {
      capture(message) {
        if (transport !== undefined) {
          forward(transport, message)
          return
        }
        if (queued.length === MAX_PENDING_CAPTURES) {
          queued.shift()
          dropped++
        }
        queued.push(message)
        void load()
      },
      // An ack-gated event (session_summary) resolves only on the real transport's 2xx answer; with no
      // transport (the sidecar did not load) it rejects, so its pending file stays for a later retry.
      async captureImmediate(message) {
        const target = await load()
        if (target?.captureImmediate === undefined) throw new Error("PostHog telemetry sidecar is not loaded")
        await target.captureImmediate(message)
      },
      async flush() {
        reportDropped()
        if (transport === undefined && loading === undefined && queued.length === 0) return
        const target = await load()
        await target?.flush?.()
      },
      async shutdown() {
        reportDropped()
        if (transport === undefined && loading === undefined && queued.length === 0) return
        const target = await load()
        await target?.shutdown()
      },
    }
    return input.loadOtlp === undefined ? posthog : withOtlpTransport(posthog, input)
  }
}

/** Neither asynchronous branch can hold up the other, including while its import is still pending. */
function withOtlpTransport(posthog: TelemetryTransport, input: LazyPostHogOptions): TelemetryTransport {
  // The native client already bounds shutdown at one second; OTLP startup gets only half of it.
  const timeoutMs = input.timeoutMs ?? 1_000
  let target: TelemetryTransport | undefined
  let starting: Promise<TelemetryTransport | undefined> | undefined
  let abandoned = false
  let closed = false
  const queued: TelemetryCaptureMessage[] = []
  const report = (error: unknown): void => {
    input.diagnostics?.({
      event: "telemetry_otlp_send_failed", source: input.source ?? "omo-telemetry",
      error, errorKind: error instanceof Error ? "error" : "non_error",
    })
  }
  const allowed = (): boolean => {
    try { return input.consent?.() ?? true } catch { return false }
  }
  const within = async <T>(operation: Promise<T>, fallback: T, rejectOnTimeout = false, boundMs = timeoutMs): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<T>((resolve, reject) => {
          timer = setTimeout(() => {
            if (rejectOnTimeout) reject(new Error("Telemetry operation timed out"))
            else resolve(fallback)
          }, boundMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const forward = (message: TelemetryCaptureMessage): void => {
    if (!allowed()) return
    try { target?.capture(message) } catch (error) { report(error) }
  }
  const captureOtlp = (message: TelemetryCaptureMessage): void => {
    if (closed || abandoned || !allowed()) return
    if (target !== undefined) return forward(message)
    if (queued.length === MAX_PENDING_CAPTURES) queued.shift()
    queued.push(message)
    starting ??= within(Promise.resolve().then(() => input.loadOtlp?.(message)).then(async value => {
      if (abandoned) {
        // A timed-out import may finish later. Dispose it instead of starting a sender after shutdown.
        await value?.shutdown()
        return undefined
      }
      target = value ?? undefined
      for (const pending of queued.splice(0)) forward(pending)
      return target
    }).catch((error: unknown) => { report(error); return undefined }), undefined, false, input.timeoutMs ?? 500).then(value => {
      abandoned = value === undefined
      queued.length = 0
      return value
    })
  }
  const finish = async (method: "flush" | "shutdown"): Promise<void> => {
    const [posthogResult] = await Promise.allSettled([
      within(Promise.resolve().then(() => posthog[method]?.()), undefined, method === "flush"),
      within((async () => {
        await starting
        if (method === "shutdown") closed = true
        await target?.[method]?.()
      })(), undefined),
    ])
    // The consent-withdrawal drain must keep its gate closed when PostHog did not drain its queue.
    if (method === "flush" && posthogResult.status === "rejected") throw posthogResult.reason
  }
  return {
    capture(message) {
      captureOtlp(message)
      posthog.capture(message)
    },
    async captureImmediate(message) {
      captureOtlp(message)
      // Pending session-summary files retain the existing PostHog acknowledgment contract.
      if (posthog.captureImmediate === undefined) throw new Error("PostHog immediate capture is unavailable")
      await within(posthog.captureImmediate(message), undefined, true)
    },
    traces: { startTurn: start => target?.traces?.startTurn(start) },
    flush: () => finish("flush"),
    shutdown: () => finish("shutdown"),
  }
}
