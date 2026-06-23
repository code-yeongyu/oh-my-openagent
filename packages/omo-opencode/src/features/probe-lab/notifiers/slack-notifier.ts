import { log } from "../../../shared"
import type { Alert } from "../alert-rules"
import type { AlertNotifier } from "../alert-notifier"

export type SlackNotifierDeps = {
  webhook_url: string
  channel?: string
  fetchImpl?: typeof fetch
}

export function createSlackAlertNotifier(deps: SlackNotifierDeps): AlertNotifier {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    async notify(alert: Alert): Promise<void> {
      const text = formatSlackText(alert)
      const payload: Record<string, unknown> = { text }
      if (deps.channel) payload.channel = deps.channel
      try {
        const res = await fetchImpl(deps.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) log("[probe-lab] slack notifier non-2xx", { status: res.status, rule: alert.rule })
      } catch (err) {
        log("[probe-lab] slack notifier failed (non-blocking)", { rule: alert.rule, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }
}

function formatSlackText(alert: Alert): string {
  const entity = alert.entity_id ? ` [${alert.entity_id}]` : ""
  return `:warning: *probe-lab ${alert.severity}* — ${alert.rule}${entity}\n${alert.message}`
}
