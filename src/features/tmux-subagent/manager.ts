import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig } from "./types"
import {
  isInsideTmux as defaultIsInsideTmux,
  getCurrentPaneId as defaultGetCurrentPaneId,
} from "../../shared/tmux"
import { log } from "../../shared"
import type { SessionMapping } from "./decision-engine"
import {
  coerceSessionCreatedEvent,
  handleSessionCreated,
  handleSessionDeleted,
  type SessionCreatedEvent,
} from "./event-handlers"
import { createSessionPollingController, type SessionPollingController } from "./polling"
import { cleanupTmuxSessions } from "./cleanup"

type OpencodeClient = PluginInput["client"]

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
}

const defaultTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: defaultIsInsideTmux,
  getCurrentPaneId: defaultGetCurrentPaneId,
}

/**
 * State-first Tmux Session Manager
 * 
 * Architecture:
 * 1. QUERY: Get actual tmux pane state (source of truth)
 * 2. DECIDE: Pure function determines actions based on state
 * 3. EXECUTE: Execute actions with verification
 * 4. UPDATE: Update internal cache only after tmux confirms success
 * 
 * The internal `sessions` Map is just a cache for sessionId<->paneId mapping.
 * The REAL source of truth is always queried from tmux.
 */
export class TmuxSessionManager {
  private client: OpencodeClient
  private tmuxConfig: TmuxConfig
  private serverUrl: string
  private sourcePaneId: string | undefined
  private sessions = new Map<string, TrackedSession>()
  private pendingSessions = new Set<string>()
  private deps: TmuxUtilDeps
  private polling: SessionPollingController

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps: TmuxUtilDeps = defaultTmuxDeps) {
    this.client = ctx.client
    this.tmuxConfig = tmuxConfig
    this.deps = deps
    const defaultPort = process.env.OPENCODE_PORT ?? "4096"
    this.serverUrl = ctx.serverUrl?.toString() ?? `http://localhost:${defaultPort}`
    this.sourcePaneId = deps.getCurrentPaneId()

    this.polling = createSessionPollingController({
      client: this.client,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
      sourcePaneId: this.sourcePaneId,
      sessions: this.sessions,
    })

    log("[tmux-session-manager] initialized", {
      configEnabled: this.tmuxConfig.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
      sourcePaneId: this.sourcePaneId,
    })
  }

  private isEnabled(): boolean {
    return this.tmuxConfig.enabled && this.deps.isInsideTmux()
  }

  private getCapacityConfig(): CapacityConfig {
    return {
      mainPaneMinWidth: this.tmuxConfig.main_pane_min_width,
      agentPaneWidth: this.tmuxConfig.agent_pane_min_width,
    }
  }

  private getSessionMappings(): SessionMapping[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      paneId: s.paneId,
      createdAt: s.createdAt,
    }))
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
    await handleSessionCreated(
      {
        client: this.client,
        tmuxConfig: this.tmuxConfig,
        serverUrl: this.serverUrl,
        sourcePaneId: this.sourcePaneId,
        sessions: this.sessions,
        pendingSessions: this.pendingSessions,
        isInsideTmux: this.deps.isInsideTmux,
        isEnabled: () => this.isEnabled(),
        getCapacityConfig: () => this.getCapacityConfig(),
        getSessionMappings: () => this.getSessionMappings(),
        waitForSessionReady: (sessionId) => this.polling.waitForSessionReady(sessionId),
        startPolling: () => this.polling.startPolling(),
      },
      event,
    )
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    await handleSessionDeleted(
      {
        tmuxConfig: this.tmuxConfig,
        serverUrl: this.serverUrl,
        sourcePaneId: this.sourcePaneId,
        sessions: this.sessions,
        isEnabled: () => this.isEnabled(),
        getSessionMappings: () => this.getSessionMappings(),
        stopPolling: () => this.polling.stopPolling(),
      },
      event,
    )
  }

  createEventHandler(): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(coerceSessionCreatedEvent(input.event))
    }
  }

  async pollSessions(): Promise<void> {
    return this.polling.pollSessions()
  }

  async cleanup(): Promise<void> {
    await cleanupTmuxSessions({
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
      sourcePaneId: this.sourcePaneId,
      sessions: this.sessions,
      stopPolling: () => this.polling.stopPolling(),
    })
  }
}
