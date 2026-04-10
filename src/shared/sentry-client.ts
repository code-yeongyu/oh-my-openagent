import * as Sentry from "@sentry/bun"

const SENTRY_DSN = "https://d6d90a57e742fede9befca3ca806c4fb@o4511160006606848.ingest.us.sentry.io/4511160013881344"
const SENTRY_FLUSH_TIMEOUT_MS = 1500

type CaptureOptions = {
  action: string
  context: Record<string, unknown>
  awaitDelivery?: boolean
}

let initialized = false
let enabled = false
let baseTags: Record<string, string> = {}

type SentryModule = {
  init: typeof Sentry.init
  captureException: typeof Sentry.captureException
  flush: typeof Sentry.flush
}

let sentryModule: SentryModule = Sentry

function toStringTag(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  return null
}

export function initSentryClient(
  baseContext: Record<string, unknown>,
  environment: string,
  release: string,
): void {
  if (initialized) return

  initialized = true
  enabled = environment !== "test" || process.env.HONEYBADGER_REPORT_DATA === "1"
  if (!enabled) return

  baseTags = {}
  for (const tagName of ["system", "repo", "component", "surface", "runtime"]) {
    const tagValue = toStringTag(baseContext[tagName])
    if (tagValue) {
      baseTags[tagName] = tagValue
    }
  }

  sentryModule.init({
    dsn: SENTRY_DSN,
    enabled: true,
    environment,
    release,
    sendDefaultPii: false,
    defaultIntegrations: false,
  })
}

export async function captureSentryError(error: Error, options: CaptureOptions): Promise<void> {
  if (!enabled) return

  try {
    sentryModule.captureException(error, {
      tags: {
        ...baseTags,
        action: options.action,
      },
      contexts: {
        telemetry: options.context,
      },
    })

    if (options.awaitDelivery) {
      await sentryModule.flush(SENTRY_FLUSH_TIMEOUT_MS)
    }
  } catch (notifyError) {
    void notifyError
  }
}

export function setSentryModuleForTest(nextModule: SentryModule): void {
  sentryModule = nextModule
}

export function resetSentryStateForTest(): void {
  initialized = false
  enabled = false
  baseTags = {}
  sentryModule = Sentry
}
