export type OncallSubcommand =
  | "status"
  | "schedule"
  | "escalate"
  | "acknowledge"
  | "handoff"
  | "runbook"
  | "alerts"
  | "metrics"

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info"

export type AlertStatus = "triggered" | "acknowledged" | "resolved" | "silenced"

export interface StatusInput {
  schedule?: string
  detailed?: boolean
}

export interface StatusResult {
  currentOncall: OncallPerson
  nextOncall: OncallPerson
  activeAlerts: AlertSummary[]
  openIncidents: IncidentSummary[]
  upcomingMaintenance: MaintenanceWindow[]
}

export interface OncallPerson {
  name: string
  email: string
  phone?: string
  schedule: string
  shiftStart: string
  shiftEnd: string
  escalationLevel: number
}

export interface AlertSummary {
  id: string
  title: string
  severity: AlertSeverity
  status: AlertStatus
  service: string
  triggeredAt: string
  acknowledgedBy?: string
}

export interface IncidentSummary {
  id: string
  title: string
  severity: string
  status: string
  createdAt: string
  commander?: string
}

export interface MaintenanceWindow {
  id: string
  title: string
  services: string[]
  startTime: string
  endTime: string
  createdBy: string
}

export interface ScheduleInput {
  schedule?: string
  action?: "view" | "swap" | "override" | "create"
  date?: string
  user?: string
  duration?: string
}

export interface ScheduleResult {
  schedule: OncallSchedule
  shifts: ShiftInfo[]
  overrides?: ScheduleOverride[]
}

export interface OncallSchedule {
  id: string
  name: string
  timezone: string
  rotationType: "daily" | "weekly" | "custom"
  participants: string[]
}

export interface ShiftInfo {
  user: OncallPerson
  start: string
  end: string
  type: "primary" | "secondary" | "override"
}

export interface ScheduleOverride {
  id: string
  user: string
  start: string
  end: string
  reason?: string
}

export interface EscalateInput {
  alertId?: string
  incidentId?: string
  reason: string
  level?: number
}

export interface EscalateResult {
  escalatedTo: OncallPerson[]
  escalationPolicy: string
  notificationsSent: NotificationRecord[]
}

export interface NotificationRecord {
  recipient: string
  channel: "sms" | "phone" | "email" | "slack" | "pagerduty"
  sentAt: string
  status: "sent" | "delivered" | "failed"
}

export interface AcknowledgeInput {
  alertId?: string
  incidentId?: string
  message?: string
}

export interface AcknowledgeResult {
  acknowledged: boolean
  acknowledgedBy: string
  acknowledgedAt: string
  escalationPaused: boolean
}

export interface HandoffInput {
  to: string
  notes?: string
  activeItems?: boolean
}

export interface HandoffResult {
  from: OncallPerson
  to: OncallPerson
  handoffTime: string
  itemsTransferred: HandoffItem[]
}

export interface HandoffItem {
  type: "alert" | "incident" | "task"
  id: string
  title: string
  status: string
  notes?: string
}

export interface RunbookInput {
  search?: string
  service?: string
  alert?: string
}

export interface RunbookResult {
  runbooks: Runbook[]
  recommended?: Runbook
}

export interface Runbook {
  id: string
  title: string
  service: string
  alertTypes: string[]
  lastUpdated: string
  steps: RunbookStep[]
  links?: string[]
}

export interface RunbookStep {
  order: number
  title: string
  description: string
  command?: string
  expectedOutcome?: string
  escalateIf?: string
}

export interface AlertsInput {
  status?: AlertStatus
  severity?: AlertSeverity
  service?: string
  since?: string
  limit?: number
}

export interface AlertsResult {
  alerts: AlertDetail[]
  summary: AlertsSummary
}

export interface AlertDetail {
  id: string
  title: string
  description: string
  severity: AlertSeverity
  status: AlertStatus
  service: string
  source: string
  triggeredAt: string
  acknowledgedAt?: string
  acknowledgedBy?: string
  resolvedAt?: string
  labels: Record<string, string>
  annotations: Record<string, string>
}

export interface AlertsSummary {
  total: number
  bySeverity: Record<AlertSeverity, number>
  byStatus: Record<AlertStatus, number>
  byService: Record<string, number>
}

export interface MetricsInput {
  schedule?: string
  period?: "day" | "week" | "month" | "quarter"
}

export interface MetricsResult {
  period: string
  alertMetrics: AlertMetrics
  incidentMetrics: IncidentMetrics
  oncallMetrics: OncallMetrics
}

export interface AlertMetrics {
  total: number
  mtta: number
  mttr: number
  bySeverity: Record<AlertSeverity, number>
  byHour: number[]
  byDay: number[]
  topServices: { service: string; count: number }[]
}

export interface IncidentMetrics {
  total: number
  mttr: number
  bySeverity: Record<string, number>
  postmortemsPending: number
}

export interface OncallMetrics {
  totalShiftHours: number
  alertsPerShift: number
  escalationRate: number
  acknowledgmentTime: number
}

export interface OncallConfig {
  defaultSchedule?: string
  timezone?: string
  escalationPolicy?: string
}
