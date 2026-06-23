import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { buildAlertContext } from "../../features/probe-lab/alert-context-builder"
import {
  createLogAlertNotifier,
  type AlertNotifier,
} from "../../features/probe-lab/alert-notifier"
import { evaluateAlertRules, type Alert } from "../../features/probe-lab/alert-rules"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

const DEDUP_WINDOW_S = 3_600

let injectedNotifier: AlertNotifier | null = null

export function __setAlertNotifierForTest(notifier: AlertNotifier | null): void {
  injectedNotifier = notifier
}

export function createProbeAlertsEvaluateTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Evaluate the 9 probe-lab alert rules against current metrics. Returns triggered alerts (deduped against alert_history within 1h) and notifies via the configured AlertNotifier (default: log to /tmp/idm.log).",
    args: {
      format: tool.schema.enum(["json", "prometheus"]).default("json"),
    },
    async execute(args) {
      try {
        const context = buildAlertContext({
          store: ctx.store,
          globalKillSwitchActive: isGlobalKillSwitchActive(ctx),
        })
        const allAlerts = evaluateAlertRules(context)
        const { fresh, suppressed } = partitionByDedup(ctx, allAlerts)
        recordFreshAlerts(ctx, fresh)
        await notifyAll(fresh)
        if (args.format === "prometheus") return formatPrometheus(fresh)
        return JSON.stringify({
          alerts: fresh,
          suppressed: suppressed.map((a) => ({ rule: a.rule, entity_id: a.entity_id })),
          evaluated_at: context.evaluated_at ?? Math.floor(Date.now() / 1000),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_alerts_evaluate failed: ${message}`
      }
    },
  })
}

function partitionByDedup(ctx: ProbeLabContext, alerts: ReadonlyArray<Alert>): { fresh: Alert[]; suppressed: Alert[] } {
  const fresh: Alert[] = []
  const suppressed: Alert[] = []
  const cutoff = Math.floor(Date.now() / 1000) - DEDUP_WINDOW_S
  for (const alert of alerts) {
    const lastFiredAt = ctx.store.getAlertHistoryLastFiredAt(alert.rule, alert.entity_id)
    if (lastFiredAt != null && lastFiredAt >= cutoff) {
      suppressed.push(alert)
      continue
    }
    fresh.push(alert)
  }
  return { fresh, suppressed }
}

function recordFreshAlerts(ctx: ProbeLabContext, alerts: ReadonlyArray<Alert>): void {
  for (const alert of alerts) {
    ctx.store.recordAlertHistory({
      rule_name: alert.rule,
      severity: alert.severity,
      message: alert.message,
      entity_id: alert.entity_id,
    })
  }
}

async function notifyAll(alerts: ReadonlyArray<Alert>): Promise<void> {
  const notifier = injectedNotifier ?? createLogAlertNotifier()
  for (const alert of alerts) await notifier.notify(alert)
}

function formatPrometheus(alerts: ReadonlyArray<Alert>): string {
  const lines: string[] = ["# HELP probe_alert_active Active probe-lab alerts (1 = triggered)", "# TYPE probe_alert_active gauge"]
  for (const alert of alerts) {
    lines.push(`probe_alert_active{rule="${alert.rule}",severity="${alert.severity}",entity="${escapeLabel(alert.entity_id ?? "")}"} 1`)
  }
  return lines.join("\n")
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")
}
