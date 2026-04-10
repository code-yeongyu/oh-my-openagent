import Honeybadger from "@honeybadger-io/js"
import { basename } from "node:path"
import packageJson from "../../package.json" with { type: "json" }
import { captureSentryError, initSentryClient, resetSentryStateForTest } from "./sentry-client"

const HONEYBADGER_API_KEY = "hbp_JEIYhdJkPoghriA4wwyd0VpmSYASVk3wo9jr"
const SENSITIVE_KEY_PATTERN = /api[_-]?key|token|secret|authorization|cookie|password|license|activation/i
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:\\|\/)/
const REDACTED_VALUE = "[REDACTED]"

type HoneybadgerBaseContext = {
  component: string
  surface: string
  runtime: "bun" | "node"
}

type CaptureOptions = {
  action: string
  context?: Record<string, unknown>
  awaitDelivery?: boolean
}

let initialized = false
let enabled = false
let baseContext: Record<string, unknown> = {}

function getEnvironment(): string {
  return process.env.HONEYBADGER_ENV ?? process.env.NODE_ENV ?? "production"
}

function shouldReportData(environment: string): boolean {
  if (process.env.HONEYBADGER_REPORT_DATA === "1") return true
  return !["dev", "development", "test"].includes(environment)
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === "string") return new Error(error)

  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

function sanitizeString(value: string): string {
  if (!ABSOLUTE_PATH_PATTERN.test(value)) return value
  return basename(value)
}

function sanitizeValue(value: unknown, key: string | null, seen: WeakSet<object>): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return REDACTED_VALUE
  if (typeof value === "string") return sanitizeString(value)
  if (typeof value !== "object" || value === null) return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key, seen))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeValue(entryValue, entryKey, seen)
  }
  return sanitized
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(context, null, new WeakSet()) as Record<string, unknown>
}

export function initHoneybadger(base: HoneybadgerBaseContext): void {
  if (initialized) return

  initialized = true
  const environment = getEnvironment()
  const reportData = environment !== "test" || process.env.HONEYBADGER_REPORT_DATA === "1"
  enabled = reportData
  baseContext = sanitizeContext({
    system: "ock-omo-system",
    repo: "oh-my-openagent",
    component: base.component,
    surface: base.surface,
    runtime: base.runtime,
    package_name: packageJson.name,
    package_version: packageJson.version,
  })
  const release = process.env.SENTRY_RELEASE ?? process.env.HONEYBADGER_REVISION ?? packageJson.version

  Honeybadger.configure({
    apiKey: HONEYBADGER_API_KEY,
    environment,
    revision: release,
    component: base.component,
    developmentEnvironments: ["dev", "development", "test"],
    reportData,
    enableUncaught: false,
    enableUnhandledRejection: false,
    filters: [
      "password",
      "token",
      "access_token",
      "refresh_token",
      "authorization",
      "cookie",
      "api_key",
      "secret",
      "license",
      "activation",
    ],
  })

  initSentryClient(baseContext, environment, release)
}

export async function captureHoneybadgerError(
  error: unknown,
  options: CaptureOptions,
): Promise<void> {
  if (!enabled) return

  const normalizedError = normalizeError(error)
  const notice = {
    action: options.action,
    component: typeof baseContext.component === "string" ? baseContext.component : undefined,
    context: sanitizeContext({
      ...baseContext,
      action: options.action,
      ...(options.context ?? {}),
    }),
  }

  if (options.awaitDelivery) {
    try {
      await Honeybadger.notifyAsync(normalizedError, notice)
    } catch (notifyError) {
      void notifyError
    }
    await captureSentryError(normalizedError, {
      action: options.action,
      context: notice.context,
      awaitDelivery: true,
    })
    return
  }

  try {
    Honeybadger.notify(normalizedError, notice)
  } catch (notifyError) {
    void notifyError
  }

  await captureSentryError(normalizedError, {
    action: options.action,
    context: notice.context,
  })
}

export function resetHoneybadgerStateForTest(): void {
  initialized = false
  enabled = false
  baseContext = {}
  Honeybadger.clear()
  resetSentryStateForTest()
}
