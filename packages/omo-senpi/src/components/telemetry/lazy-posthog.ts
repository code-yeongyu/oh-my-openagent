import type {
  TelemetryCaptureMessage,
  TelemetryDiagnosticInput,
  TelemetryTransport,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"

type PostHogRuntime = { readonly createDefaultPostHogTransport: TelemetryTransportFactory }
type LazyPostHogOptions = {
  readonly load?: () => Promise<PostHogRuntime>
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
    return {
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
  }
}
