import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { listUnreadMessages } from "../team-mailbox/inbox"
import {
  applyMemberSessionRouting,
  buildMemberPromptBody,
} from "../member-session-routing"
import { loadRuntimeState } from "../team-state-store/store"

/**
 * Background watchdog for team members whose session has stalled mid-turn
 * (e.g., the SDK transport stream truncated and the JSON parse error left
 * the session unable to accept new prompts cleanly). Without this watchdog,
 * subsequent `team_send_message` promptAsync calls queue indefinitely
 * behind the dead turn and the lead never finds out.
 *
 * Strategy: at every `mailbox_poll_interval_ms` tick, for each running
 * member that has unread messages in inbox, sample the session's message
 * count. If the count has not advanced for `STUCK_THRESHOLD_MULTIPLIER`
 * ticks, treat the session as stuck — abort the in-flight request and
 * re-prompt with a wake hint that points the recipient at the inbox.
 *
 * Scope: ONLY fires when there are pending unread messages. A healthy idle
 * member with no work is left alone.
 */

export const STUCK_THRESHOLD_MULTIPLIER = 60

export interface StuckMonitorClient {
  session: {
    abort?: (input: { path: { id: string } }) => Promise<unknown>
    promptAsync?: (input: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }
      query: { directory: string }
    }) => Promise<unknown>
    messages?: (input: {
      path: { id: string }
      query: { directory: string }
    }) => Promise<{ data?: unknown[] } | unknown>
  }
}

export interface MemberProbe {
  lastMessageCount: number
  lastProgressAt: number
}

export interface StuckMonitorTickArgs {
  teamRunId: string
  config: TeamModeConfig
  client: StuckMonitorClient
  directory: string
  probesByMember: Map<string, MemberProbe>
  now?: () => number
  stuckThresholdMs?: number
}

function buildWakeHintBody(unreadCount: number): string {
  return `[team-stuck-recovery] You have ${unreadCount} pending team message(s) that have not been delivered yet. Read them now.`
}

function extractMessageCount(response: unknown): number {
  if (response && typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (Array.isArray(data)) return data.length
  }
  if (Array.isArray(response)) return response.length
  return 0
}

export async function tickStuckSessionMonitor(args: StuckMonitorTickArgs): Promise<void> {
  const {
    teamRunId,
    config,
    client,
    directory,
    probesByMember,
  } = args
  const now = (args.now ?? (() => Date.now()))()
  const stuckThresholdMs = args.stuckThresholdMs
    ?? config.mailbox_poll_interval_ms * STUCK_THRESHOLD_MULTIPLIER

  let runtimeState
  try {
    runtimeState = await loadRuntimeState(teamRunId, config)
  } catch {
    return
  }

  if (
    runtimeState.status === "deleting"
    || runtimeState.status === "deleted"
    || runtimeState.status === "failed"
  ) {
    probesByMember.clear()
    return
  }

  for (const member of runtimeState.members) {
    if (member.status !== "running" || !member.sessionId) {
      probesByMember.delete(member.name)
      continue
    }

    const unreadMessages = await listUnreadMessages(teamRunId, member.name, config).catch(() => [])
    if (unreadMessages.length === 0) {
      probesByMember.delete(member.name)
      continue
    }

    if (typeof client.session.messages !== "function") {
      // Cannot probe — leave probe state alone, no action.
      continue
    }

    const messages = await client.session.messages({
      path: { id: member.sessionId },
      query: { directory },
    }).catch(() => null)
    const messageCount = extractMessageCount(messages)

    const previous = probesByMember.get(member.name)
    if (!previous || messageCount > previous.lastMessageCount) {
      probesByMember.set(member.name, { lastMessageCount: messageCount, lastProgressAt: now })
      continue
    }

    if (now - previous.lastProgressAt < stuckThresholdMs) continue

    log("[team-stuck-monitor] member stuck — aborting and re-prompting", {
      teamRunId,
      memberName: member.name,
      sessionId: member.sessionId,
      unreadCount: unreadMessages.length,
      idleMs: now - previous.lastProgressAt,
    })

    if (typeof client.session.abort === "function") {
      await client.session.abort({ path: { id: member.sessionId } }).catch((error: unknown) => {
        log("[team-stuck-monitor] abort failed", {
          teamRunId,
          memberName: member.name,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    if (typeof client.session.promptAsync === "function") {
      applyMemberSessionRouting(member.sessionId, member)
      await client.session.promptAsync({
        path: { id: member.sessionId },
        body: buildMemberPromptBody(member, buildWakeHintBody(unreadMessages.length)),
        query: { directory: member.worktreePath ?? directory },
      }).catch((error: unknown) => {
        log("[team-stuck-monitor] re-prompt failed", {
          teamRunId,
          memberName: member.name,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    // Reset baseline so the next tick measures progress AFTER the wake.
    probesByMember.set(member.name, { lastMessageCount: messageCount, lastProgressAt: now })
  }
}

export interface StartStuckSessionMonitorArgs {
  teamRunId: string
  config: TeamModeConfig
  client: StuckMonitorClient
  directory: string
}

export type StopStuckSessionMonitor = () => void

declare function setInterval(callback: () => void, delay?: number): { unref?: () => void }
declare function clearInterval(interval: { unref?: () => void }): void

/**
 * Starts the periodic stuck-session monitor for a single team run. Returns
 * a stop function that the team-runtime delete/cleanup path must call to
 * release the interval.
 */
export function startStuckSessionMonitor(args: StartStuckSessionMonitorArgs): StopStuckSessionMonitor {
  const probesByMember = new Map<string, MemberProbe>()
  const tickArgs: StuckMonitorTickArgs = {
    teamRunId: args.teamRunId,
    config: args.config,
    client: args.client,
    directory: args.directory,
    probesByMember,
  }

  let stopped = false
  const intervalMs = Math.max(500, args.config.mailbox_poll_interval_ms)
  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      await tickStuckSessionMonitor(tickArgs)
    } catch (error) {
      log("[team-stuck-monitor] tick threw", {
        teamRunId: args.teamRunId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const interval = setInterval(() => { void tick() }, intervalMs)
  if (typeof interval.unref === "function") interval.unref()

  return (): void => {
    if (stopped) return
    stopped = true
    clearInterval(interval)
    probesByMember.clear()
  }
}

// ----------------------------------------------------------------------------
// Module-level registry for active monitors (one per teamRunId).
//
// `createTeamRun` calls `registerStuckSessionMonitor` after the team transitions
// to `active`, and `deleteTeam` calls `stopStuckSessionMonitor` to release the
// interval before the runtime state directory is removed. The registry is
// in-process only — restarting the host process drops all timers, which is
// fine because the team runtime state on disk is the source of truth.
// ----------------------------------------------------------------------------

const activeMonitors = new Map<string, StopStuckSessionMonitor>()

export function registerStuckSessionMonitor(
  teamRunId: string,
  stop: StopStuckSessionMonitor,
): void {
  const previous = activeMonitors.get(teamRunId)
  if (previous) {
    previous()
  }
  activeMonitors.set(teamRunId, stop)
}

export function stopStuckSessionMonitor(teamRunId: string): boolean {
  const stop = activeMonitors.get(teamRunId)
  if (!stop) return false
  stop()
  activeMonitors.delete(teamRunId)
  return true
}

export function clearAllStuckSessionMonitors(): void {
  for (const stop of activeMonitors.values()) {
    stop()
  }
  activeMonitors.clear()
}
