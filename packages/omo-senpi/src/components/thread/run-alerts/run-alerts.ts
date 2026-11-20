import type { ResolvedErrorStreakSettings } from "@oh-my-opencode/omo-config-core"

import type { AgentEndFacts } from "../gateway/completion"
import { PAIR_BUCKET_REFILL_MS } from "../gateway/constants"
import type { ThreadToolResult } from "../contracts"
import type { ThreadSendAs } from "../tools"
import { createErrorStreakDetector, runEndOf, type ErrorStreakEvent, type RunEnd } from "./error-streak"

const ALERT_REQUEST_TIMEOUT_MS = 10_000
const ALERT_WEBHOOK_RETRY_DELAY_MS = 2_000
// A seat that just spent its pair burst on the same thread gets a token back after one refill.
const ALERT_THREAD_RETRY_DELAY_MS = PAIR_BUCKET_REFILL_MS

export type RunAlertsOptions = {
  readonly settings: () => ResolvedErrorStreakSettings
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: () => number
  readonly sendAs: ThreadSendAs
  readonly sessionName: () => string | undefined
  readonly device: () => Promise<string | undefined>
  readonly fetch?: typeof fetch
  readonly delay?: (ms: number) => Promise<void>
  readonly log: { readonly info: (line: string) => void; readonly warn: (line: string) => void }
}

export type RunAlerts = {
  readonly agentEnd: (durableId: string, event: AgentEndFacts) => void
  /** Never waits for an alert: delivery runs in the background with its own bounded retry. */
  readonly settled: (durableId: string) => void
}

type AlertPayload = ErrorStreakEvent & {
  readonly text: string
  readonly name: string | null
  readonly device: string | null
}

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })

/**
 * Error-streak alerts (#14430): each settled run's outcome (the last `agent_end` before `agent_settled`, as completions
 * read it) feeds the detector; an alert goes to every configured thread through thread_send, as the failing session, and
 * to the configured webhook. An alert carries metadata only: names, ids, counts, error classes, times, provider and model,
 * never prompt text, tool output or message content.
 */
export function createRunAlerts(options: RunAlertsOptions): RunAlerts {
  const lastEnd = new Map<string, RunEnd>()
  let state:
    | { settings: ResolvedErrorStreakSettings; observe: (id: string, end: RunEnd) => ErrorStreakEvent | undefined }
    | undefined
  let missingWebhookReported = false
  const delay = options.delay ?? defaultDelay

  const detector = () => {
    if (state === undefined) {
      const settings = options.settings()
      const detect = createErrorStreakDetector({
        threshold: settings.threshold,
        realertMs: settings.realertMs,
        now: options.now,
      })
      state = { settings, observe: (id, end) => detect.observe(id, end) }
    }
    return state
  }

  async function toThread(address: string, payload: AlertPayload): Promise<void> {
    const args = {
      thread: address,
      message: `${payload.text}\n${JSON.stringify(withoutText(payload))}`,
      delivery: "auto" as const,
      all_scope: true,
      idempotency_key: `operator-alert:${payload.event}:${payload.session_id}:${payload.first_at}:${payload.count}:${address}`,
    }
    let result: ThreadToolResult | undefined
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await options.sendAs(payload.session_id, args).catch((error: unknown): ThreadToolResult => ({
        kind: "error",
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.name : "error",
          next_action: "",
        },
      }))
      if (result.kind === "ok") {
        options.log.info(`operator alert: ${payload.event} for ${payload.session_id} sent to thread ${address}`)
        return
      }
      if (attempt === 1) await delay(ALERT_THREAD_RETRY_DELAY_MS)
    }
    const code = result?.kind === "error" ? result.error.code : "unknown"
    options.log.warn(
      `operator alert: ${payload.event} for ${payload.session_id} not sent to thread ${address}: ${code}`,
    )
  }

  async function toWebhook(url: string, payload: AlertPayload): Promise<void> {
    const post = options.fetch ?? fetch
    let failure = "unknown"
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await post(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(ALERT_REQUEST_TIMEOUT_MS),
        })
        if (response.ok) {
          options.log.info(`operator alert: ${payload.event} for ${payload.session_id} sent to the webhook`)
          return
        }
        failure = `HTTP ${response.status}`
      } catch (error) {
        // The URL is a secret: only the error's name or code is logged, never its message.
        failure =
          (error as { readonly code?: unknown } | null)?.code?.toString() ?? (error as Error | null)?.name ?? "error"
      }
      if (attempt === 1) await delay(ALERT_WEBHOOK_RETRY_DELAY_MS)
    }
    options.log.warn(`operator alert: ${payload.event} for ${payload.session_id} not sent to the webhook: ${failure}`)
  }

  async function dispatch(event: ErrorStreakEvent, settings: ResolvedErrorStreakSettings): Promise<void> {
    const name = options.sessionName()?.trim() || null
    const device = (await options.device().catch(() => undefined)) ?? null
    const payload: AlertPayload = { ...event, text: alertLine(event, name, device), name, device }
    options.log.warn(payload.text)
    const url = settings.webhookUrlEnv === undefined ? undefined : options.env[settings.webhookUrlEnv]?.trim()
    if (settings.webhookUrlEnv !== undefined && !url && !missingWebhookReported) {
      missingWebhookReported = true
      options.log.warn(
        `operator alert: operator_alerts.error_streak.webhook_url_env names ${settings.webhookUrlEnv}, which is not set; no webhook is called`,
      )
    }
    await Promise.all([
      ...settings.threads.map((address) => toThread(address, payload)),
      ...(url ? [toWebhook(url, payload)] : []),
    ])
  }

  return {
    agentEnd: (durableId, event) => {
      lastEnd.set(durableId, runEndOf(event))
    },
    settled: (durableId) => {
      const end = lastEnd.get(durableId)
      if (end === undefined) return
      lastEnd.delete(durableId)
      const current = detector()
      const event = current.observe(durableId, end)
      if (event === undefined) return
      void dispatch(event, current.settings).catch((error: unknown) =>
        options.log.warn(
          `operator alert: ${event.event} for ${durableId} failed: ${(error as Error | null)?.name ?? "error"}`,
        ),
      )
    },
  }
}

function withoutText(payload: AlertPayload): Omit<AlertPayload, "text"> {
  const { text: _text, ...facts } = payload
  return facts
}

function alertLine(event: ErrorStreakEvent, name: string | null, device: string | null): string {
  const seat = `session ${name === null ? "" : `"${name}" `}(${event.session_id}) on ${device === null ? "this device" : `device ${device}`}`
  const classes = Object.entries(event.classes)
    .map(([errorClass, count]) => `${errorClass} ${count}`)
    .join(", ")
  const span = `first ${iso(event.first_at)}, last ${iso(event.last_at)}`
  if (event.event === "error_streak_recovered")
    return `omo alert: ${seat} recovered at ${iso(event.recovered_at)} after ${event.count} runs in a row ended with an error (${classes}); ${span}`
  const model =
    event.model === undefined ? "" : `; model ${event.provider === undefined ? "" : `${event.provider}/`}${event.model}`
  if (event.repeat)
    return `omo alert: ${seat} is still failing: ${event.count} runs in a row ended with an error (${classes}); ${span}${model}`
  return `omo alert: ${seat} ended ${event.count} runs in a row with an error (${classes}); ${span}${model}`
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}
