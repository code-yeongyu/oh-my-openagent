import { log } from "../../shared"
import type { Alert } from "./alert-rules"

export interface AlertNotifier {
  notify(alert: Alert): Promise<void>
}

export function createLogAlertNotifier(): AlertNotifier {
  return {
    async notify(alert: Alert): Promise<void> {
      log(`[probe-lab] alert ${alert.rule} [${alert.severity}] ${alert.message}`, {
        rule: alert.rule,
        severity: alert.severity,
        entity_id: alert.entity_id,
        evaluated_at: alert.evaluated_at,
      })
    },
  }
}
