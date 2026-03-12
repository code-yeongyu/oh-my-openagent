import { statSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  appendSessionId,
  clearBoulderState,
  createBoulderState,
  findPrometheusPlans,
  getPlanName,
  getPlanProgress,
  readBoulderState,
  writeBoulderState,
} from "../../features/boulder-state"
import { bootstrapTeamModeRun, getTeamStatePath, initializeTeamRuntime, readTeamRuntimeState } from "../../features/team-mode"
import type { BackgroundManager } from "../../features/background-agent"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { isInsideTmux } from "../../shared/tmux"
import { parseUserRequest } from "../start-work/parse-user-request"
import { detectWorktreePath } from "../start-work/worktree-detector"

const TEAMMODE_MARKER = "You are starting Atlas Team Mode."
const HOOK_NAME = "start-teammode"

interface StartTeammodeHookInput {
  sessionID: string
  messageID?: string
}

interface StartTeammodeHookOutput {
  parts: Array<{ type: string; text?: string }>
}

function createWorktreeBlock(worktreePath: string): string {
  return `\n**Worktree**: \`${worktreePath}\``
}

function findPlanByName(plans: string[], requestedPlanName: string): string | null {
  const lowerName = requestedPlanName.toLowerCase()
  return (
    plans.find((planPath) => getPlanName(planPath).toLowerCase() === lowerName) ??
    plans.find((planPath) => getPlanName(planPath).toLowerCase().includes(lowerName)) ??
    null
  )
}

function resolveRequestedPlan(directory: string, requestedPlanName: string | null): string | null {
  const plans = findPrometheusPlans(directory)
  if (!requestedPlanName) {
    const incomplete = plans.filter((planPath) => !getPlanProgress(planPath).isComplete)
    return incomplete.length === 1 ? incomplete[0] : null
  }

  return findPlanByName(plans, requestedPlanName)
}

function isStartTeammodePrompt(promptText: string): boolean {
  return promptText.includes(TEAMMODE_MARKER) && promptText.includes("<session-context>")
}

function buildPlanSelectionMessage(input: {
  directory: string
  requestedPlanName: string | null
  timestamp: string
  sessionID: string
  worktreeBlock: string
}): string {
  const plans = findPrometheusPlans(input.directory)
  const incompletePlans = plans.filter((planPath) => !getPlanProgress(planPath).isComplete)

  if (input.requestedPlanName) {
    if (incompletePlans.length > 0) {
      const planList = incompletePlans
        .map((planPath, index) => {
          const progress = getPlanProgress(planPath)
          return `${index + 1}. [${getPlanName(planPath)}] - Progress: ${progress.completed}/${progress.total}`
        })
        .join("\n")

      return `\n## Plan Not Found\n\nCould not find a plan matching "${input.requestedPlanName}".\n\nAvailable incomplete plans:\n${planList}\n\nAsk the user which plan to use.${input.worktreeBlock}`
    }

    return `\n## Plan Not Found\n\nCould not find a plan matching "${input.requestedPlanName}".\nNo incomplete plans are available. Create a new plan with: /plan "your task"${input.worktreeBlock}`
  }

  if (plans.length === 0) {
    return `\n## No Plans Found\n\nNo Prometheus plan files found at .sisyphus/plans/\nUse Prometheus to create a work plan first: /plan "your task"${input.worktreeBlock}`
  }

  if (incompletePlans.length === 0) {
    return `\n## All Plans Complete\n\nAll ${plans.length} plan(s) are complete. Create a new plan with: /plan "your task"${input.worktreeBlock}`
  }

  const planList = incompletePlans
    .map((planPath, index) => {
      const progress = getPlanProgress(planPath)
      const modified = new Date(statSync(planPath).mtimeMs).toISOString()
      return `${index + 1}. [${getPlanName(planPath)}] - Modified: ${modified} - Progress: ${progress.completed}/${progress.total}`
    })
    .join("\n")

  return `\n<system-reminder>\n## Multiple Plans Found\n\nCurrent Time: ${input.timestamp}\nSession ID: ${input.sessionID}\n\n${planList}\n\nAsk the user which plan to use.${input.worktreeBlock}\n</system-reminder>`
}

export function createStartTeammodeHook(ctx: PluginInput, backgroundManager: BackgroundManager) {
  return {
    "chat.message": async (input: StartTeammodeHookInput, output: StartTeammodeHookOutput): Promise<void> => {
      const promptText = output.parts.filter((part) => part.type === "text" && part.text).map((part) => part.text).join("\n")
      if (!isStartTeammodePrompt(promptText)) return

      if (!isInsideTmux()) {
        const idx = output.parts.findIndex((part) => part.type === "text" && part.text)
        if (idx >= 0 && output.parts[idx].text) {
          output.parts[idx].text = output.parts[idx].text
            .replace(/\$SESSION_ID/g, input.sessionID)
            .replace(/\$TIMESTAMP/g, new Date().toISOString())
          output.parts[idx].text += "\n\n---\n## Team Mode Requires tmux\n\n`start-teammode` only succeeds when OpenCode is running inside tmux, because each worker must get a real pane/session. Start OpenCode inside tmux and retry."
        }
        return
      }

      updateSessionAgent(input.sessionID, "atlas")
      const timestamp = new Date().toISOString()
      const existingState = readBoulderState(ctx.directory)
      const { planName: requestedPlanName, explicitWorktreePath } = parseUserRequest(promptText)
      const resolvedWorktreePath = explicitWorktreePath ? detectWorktreePath(explicitWorktreePath) ?? undefined : undefined
      const existingTeamId = existingState?.execution_mode === "teammode" ? existingState.active_team_id : undefined
      const existingTeam = existingTeamId ? readTeamRuntimeState(ctx.directory, existingTeamId) : null
      const worktreeBlock = resolvedWorktreePath ? createWorktreeBlock(resolvedWorktreePath) : ""

      if (existingState?.execution_mode === "teammode" && existingTeam && existingTeam.manifest.phase !== "shutdown") {
        appendSessionId(ctx.directory, input.sessionID)
        const idx = output.parts.findIndex((part) => part.type === "text" && part.text)
        if (idx >= 0 && output.parts[idx].text) {
          output.parts[idx].text = output.parts[idx].text
            .replace(/\$SESSION_ID/g, input.sessionID)
            .replace(/\$TIMESTAMP/g, timestamp)
          output.parts[idx].text += `\n\n---\n## Active Team Mode Found\n\n**Team**: ${existingTeam.manifest.team_id}\n**Plan**: ${existingTeam.manifest.plan_name}\n**State Path**: ${getTeamStatePath(ctx.directory, existingTeam.manifest.team_id)}${worktreeBlock}`
        }
        return
      }

      const planPath = resolveRequestedPlan(ctx.directory, requestedPlanName)
      if (!planPath) {
        const idx = output.parts.findIndex((part) => part.type === "text" && part.text)
        if (idx >= 0 && output.parts[idx].text) {
          output.parts[idx].text = output.parts[idx].text
            .replace(/\$SESSION_ID/g, input.sessionID)
            .replace(/\$TIMESTAMP/g, timestamp)
          output.parts[idx].text += `\n\n---\n${buildPlanSelectionMessage({
            directory: ctx.directory,
            requestedPlanName,
            timestamp,
            sessionID: input.sessionID,
            worktreeBlock,
          })}`
        }
        return
      }

      const progress = getPlanProgress(planPath)
      if (progress.isComplete) return

      if (existingState) clearBoulderState(ctx.directory)
      const runtimeState = initializeTeamRuntime({
        directory: ctx.directory,
        leaderSessionId: input.sessionID,
        planPath,
        planName: getPlanName(planPath),
        worktreePath: resolvedWorktreePath,
      })
      const teamStatePath = getTeamStatePath(ctx.directory, runtimeState.manifest.team_id)
      const boulderState = createBoulderState(planPath, input.sessionID, "atlas", resolvedWorktreePath, {
        execution_mode: "teammode",
        active_team_id: runtimeState.manifest.team_id,
        team_state_path: teamStatePath,
      })
      writeBoulderState(ctx.directory, boulderState)

      await bootstrapTeamModeRun({
        backgroundManager,
        directory: ctx.directory,
        teamId: runtimeState.manifest.team_id,
        sessionID: input.sessionID,
        parentMessageID: input.messageID,
        planName: runtimeState.manifest.plan_name,
        teamStatePath,
        workerIds: runtimeState.workers.filter((worker) => worker.role === "worker").map((worker) => worker.id),
        worktreePath: resolvedWorktreePath,
      })

      const idx = output.parts.findIndex((part) => part.type === "text" && part.text)
      if (idx >= 0 && output.parts[idx].text) {
        output.parts[idx].text = output.parts[idx].text
          .replace(/\$SESSION_ID/g, input.sessionID)
          .replace(/\$TIMESTAMP/g, timestamp)
        output.parts[idx].text += `\n\n---\n## Team Mode Started\n\n**Plan**: ${runtimeState.manifest.plan_name}\n**Team**: ${runtimeState.manifest.team_id}\n**Runtime State**: ${teamStatePath}\n**Workers**: ${runtimeState.workers.filter((worker) => worker.role === "worker").length}${worktreeBlock}`
      }

      log(`[${HOOK_NAME}] Team mode bootstrapped`, {
        sessionID: input.sessionID,
        teamId: runtimeState.manifest.team_id,
        planPath,
      })
    },
  }
}
