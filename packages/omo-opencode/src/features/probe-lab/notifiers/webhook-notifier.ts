import { log } from "../../../shared"
import type { Alert } from "../alert-rules"
import type { AlertNotifier } from "../alert-notifier"

export type WebhookNotifierDeps = {
  url: string
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
}

export function createWebhookAlertNotifier(deps: WebhookNotifierDeps): AlertNotifier {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    async notify(alert: Alert): Promise<void> {
      try {
        const res = await fetchImpl(deps.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(deps.headers ?? {}) },
          body: JSON.stringify(alert),
        })
        if (!res.ok) log("[probe-lab] webhook notifier non-2xx", { url: deps.url, status: res.status, rule: alert.rule })
      } catch (err) {
        log("[probe-lab] webhook notifier failed (non-blocking)", { url: deps.url, rule: alert.rule, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }
}
