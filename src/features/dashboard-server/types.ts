import type { ActivityEvent } from "../activity-bus/types"

export type DashboardClientMessage = {
  type: "subscribe" | "unsubscribe" | "ping"
  filter?: string[]
}

export type DashboardServerMessage = {
  type: "event" | "snapshot" | "pong" | "error"
  data?: ActivityEvent
  snapshot?: { running: number; queued: number }
  error?: string
}

export type DashboardServerConfig = {
  port: number
  host?: string
}
