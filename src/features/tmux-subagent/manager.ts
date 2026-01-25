import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession } from "./types"
import {
  spawnTmuxPane,
  closeTmuxPane,
  isInsideTmux,
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_MISSING_GRACE_MS,
} from "../../shared/tmux"

export class TmuxSessionManager {
  private enabled: boolean
  private sessions: Map<string, TrackedSession>
  private serverUrl: string
  private config: TmuxConfig
  private ctx: PluginInput
  private pollingInterval: ReturnType<typeof setInterval> | null = null

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig) {
    this.ctx = ctx
    this.config = tmuxConfig
    this.sessions = new Map()

    this.enabled = tmuxConfig.enabled && isInsideTmux()

    const defaultPort = process.env.OPENCODE_PORT ?? "4096"
    const urlString = ctx.serverUrl?.toString() ?? `http://localhost:${defaultPort}`
    this.serverUrl = urlString.endsWith("/") ? urlString.slice(0, -1) : urlString

    if (this.enabled) {
      this.startPolling()
    }
  }

  async onSessionCreated(event: {
    sessionID: string
    parentID?: string
    title: string
  }): Promise<void> {
    if (!this.enabled) return
    if (!event.parentID) return

    const result = await spawnTmuxPane(
      event.sessionID,
      event.title,
      this.config,
      this.serverUrl
    )

    if (result.success && result.paneId) {
      this.sessions.set(event.sessionID, {
        sessionId: event.sessionID,
        paneId: result.paneId,
        description: event.title,
        createdAt: new Date(),
        lastSeenAt: new Date(),
      })
    }
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.enabled) return

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    await this.closeSession(event.sessionID)
  }

  async pollSessions(): Promise<void> {
    if (!this.enabled) return
    if (this.sessions.size === 0) return

    try {
      const statusResult = await this.ctx.client.session.status({ path: undefined })
      const statuses = (statusResult.data ?? {}) as Record<string, { type: string }>

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = statuses[sessionId]

        if (!status) {
          const missingSince = Date.now() - tracked.lastSeenAt.getTime()
          if (missingSince > SESSION_MISSING_GRACE_MS) {
            await this.closeSession(sessionId)
          }
          continue
        }

        tracked.lastSeenAt = new Date()

        if (status.type === "idle") {
          await this.closeSession(sessionId)
        }
      }
    } catch {
      // Ignore errors
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    await closeTmuxPane(tracked.paneId)
    this.sessions.delete(sessionId)
  }

  async cleanup(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    for (const sessionId of Array.from(this.sessions.keys())) {
      await this.closeSession(sessionId)
    }
  }

  private startPolling(): void {
    this.pollingInterval = setInterval(() => {
      this.pollSessions().catch(() => {
        // Ignore errors
      })
    }, POLL_INTERVAL_BACKGROUND_MS)
  }
}
