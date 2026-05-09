import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import * as sharedTmuxModule from "../../../shared/tmux"
import * as tmuxPathResolverModule from "../../../tools/interactive-bash/tmux-path-resolver"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { buildLiveTailCommand } from "../team-layout-tmux/live-tail"
import { loadRuntimeState, assertTeamServedByCurrentInstance, TeamFromDeadInstanceError } from "../team-state-store/store"

type TmuxCommandResult = Awaited<ReturnType<typeof sharedTmuxModule.runTmuxCommand>>

export type TeamRefreshPanesToolDeps = {
  loadRuntimeState: typeof loadRuntimeState
  assertTeamServedByCurrentInstance: typeof assertTeamServedByCurrentInstance
  runTmuxCommand: (tmuxPath: string, args: Array<string>) => Promise<TmuxCommandResult>
  getTmuxPath: typeof tmuxPathResolverModule.getTmuxPath
  buildLiveTailCommand: typeof buildLiveTailCommand
}

const defaultDeps: TeamRefreshPanesToolDeps = {
  loadRuntimeState,
  assertTeamServedByCurrentInstance,
  runTmuxCommand: sharedTmuxModule.runTmuxCommand,
  getTmuxPath: tmuxPathResolverModule.getTmuxPath,
  buildLiveTailCommand,
}

const TeamRefreshPanesArgsSchema = z.object({
  teamRunId: z.string().min(1),
  allowInsecureTls: z.boolean().optional().default(false),
})

export { TeamFromDeadInstanceError }

export function createTeamRefreshPanesTool(
  config: TeamModeConfig,
  tmuxMgr: TmuxSessionManager | undefined,
  deps: TeamRefreshPanesToolDeps = defaultDeps,
): ToolDefinition {
  return tool({
    description: "Re-spawn live-tail panes for all current team members using the CURRENT opencode server URL. Use after closing & reopening a terminal window when previous panes are pointing at a dead server.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID to refresh"),
      allowInsecureTls: tool.schema.boolean().optional().default(false).describe("Pass --insecure to the live-tail script (local/dev TLS only)"),
    },
    execute: async (rawArgs, toolContext) => {
      const args = TeamRefreshPanesArgsSchema.parse(rawArgs)
      const ctx = toolContext as { sessionID?: string }

      // Step 1: load runtime state
      const rs = await deps.loadRuntimeState(args.teamRunId, config)

      // Step 2: participant authorization (caller must be lead OR a member)
      const isLead = rs.leadSessionId === ctx.sessionID
      const isMember = rs.members.some((m) => m.sessionId === ctx.sessionID)
      if (!isLead && !isMember) {
        throw new Error("team_refresh_panes: caller must be a team participant (lead or member)")
      }

      // Step 3: assertTeamServedByCurrentInstance MUST run before any tmux mutation
      // (B3 — order matters; otherwise we'd respawn panes pointing at a stale URL)
      const currentServerUrl = tmuxMgr?.getServerUrl()
      await deps.assertTeamServedByCurrentInstance(rs, currentServerUrl, undefined)

      // Step 4: tmux availability gate
      if (!tmuxMgr || !currentServerUrl) {
        return JSON.stringify({
          teamRunId: args.teamRunId,
          serverUrl: currentServerUrl ?? null,
          refreshed: [],
          skipped: rs.members.map((m) => m.name),
          failed: [],
          reason: "tmux unavailable",
        })
      }

      const tmuxPath = await deps.getTmuxPath()
      if (!tmuxPath) {
        return JSON.stringify({
          teamRunId: args.teamRunId,
          serverUrl: currentServerUrl,
          refreshed: [],
          skipped: rs.members.map((m) => m.name),
          failed: [],
          reason: "tmux unavailable (path resolution failed)",
        })
      }

      // Step 5: respawn-pane for each member with grid pane + sessionId
      const refreshed: string[] = []
      const skipped: string[] = []
      const failed: Array<{ name: string; error: string }> = []

      for (const member of rs.members) {
        const paneId = member.tmuxGridPaneId
        if (!paneId || !member.sessionId) {
          skipped.push(member.name)
          continue
        }
        try {
          const cmd = deps.buildLiveTailCommand(currentServerUrl, member.sessionId, {
            allowInsecureTls: args.allowInsecureTls,
          })
          // tmux respawn-pane -k atomically kills the existing process and starts the new one.
          // Eliminates the Ctrl-C → sleep race that an iterative kill+send would have.
          const result = await deps.runTmuxCommand(tmuxPath, [
            "respawn-pane",
            "-k",
            "-t",
            paneId,
            cmd,
          ])
          if (!result.success) {
            failed.push({ name: member.name, error: result.stderr || "tmux respawn-pane failed" })
            continue
          }
          refreshed.push(member.name)
        } catch (error) {
          failed.push({ name: member.name, error: error instanceof Error ? error.message : String(error) })
        }
      }

      log("[team-refresh-panes] complete", {
        teamRunId: args.teamRunId,
        serverUrl: currentServerUrl,
        refreshed,
        skipped,
        failed,
      })

      return JSON.stringify({
        teamRunId: args.teamRunId,
        serverUrl: currentServerUrl,
        refreshed,
        skipped,
        failed,
      })
    },
  })
}
