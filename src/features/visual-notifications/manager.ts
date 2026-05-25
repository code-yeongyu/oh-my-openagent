import type { ActivityBus, ActivityEvent } from "../activity-bus"

export type VisualNotificationConfig = {
  on_task_complete: boolean
  on_error: boolean
  on_team_member_join: boolean
  sound: boolean
}

export class VisualNotificationManager {
  private bus: ActivityBus
  private config: VisualNotificationConfig
  private lastNotifyByType: Map<string, number> = new Map()
  private unsubscribe: (() => void) | null = null

  constructor(bus: ActivityBus, config: VisualNotificationConfig) {
    this.bus = bus
    this.config = config
  }

  start(): void {
    this.unsubscribe = this.bus.onAny((event: ActivityEvent) => {
      if (!this.shouldNotify(event.kind)) return
      if (this.isRateLimited(event.kind)) return
      this.lastNotifyByType.set(event.kind, Date.now())

      if (event.kind === "task:completed" && this.config.on_task_complete) {
        this.showNotification(`✅ ${event.data.taskId} completed`)
      } else if (event.kind === "task:error" && this.config.on_error) {
        this.showNotification(`❌ ${event.data.taskId} error: ${event.data.error}`)
        if (this.config.sound) this.playBeep()
      } else if (event.kind === "team:created" && this.config.on_team_member_join) {
        this.showNotification(`🤖 Team "${event.data.name}" created`)
      }
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  updateConfig(config: Partial<VisualNotificationConfig>): void {
    this.config = { ...this.config, ...config }
  }

  private shouldNotify(kind: string): boolean {
    return kind === "task:completed" || kind === "task:error" || kind === "team:created"
  }

  private isRateLimited(kind: string): boolean {
    const last = this.lastNotifyByType.get(kind)
    if (!last) return false
    return Date.now() - last < 2000 // max 1 per 2s per type
  }

  private showNotification(message: string): void {
    try {
      // Try desktop toast via client.tui.showToast if available
      if (typeof process !== "undefined" && (process as any).stdout?.write) {
        process.stdout.write(`\n\x1b[90m[notification]\x1b[0m ${message}\n`)
      }
    } catch {
      console.log(`[notification] ${message}`)
    }
  }

  private playBeep(): void {
    try {
      process.stdout.write("\x07")
    } catch {
      // Terminal beep failed - ignore
    }
  }
}
