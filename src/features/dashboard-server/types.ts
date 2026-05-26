import type { ActivityEvent } from "../activity-bus/types"
import type { AnalyticsSnapshot } from "../agent-analytics/types"

export type DashboardClientMessage = {
  type: "subscribe" | "unsubscribe" | "ping"
  filter?: string[]
}

export type DashboardServerMessage = {
  type: "event" | "snapshot" | "pong" | "error"
  data?: ActivityEvent
  snapshot?: { running: number; queued: number; analytics?: AnalyticsSnapshot }
  error?: string
}

export type DashboardServerConfig = {
  port: number
  host?: string
}
