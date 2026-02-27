import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { getCurrentPhase, isExecutingPhase } from "../../features/boulder-state"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { getMessageDir, isCallerOrchestrator } from "../../shared/session-utils"
import { createEventHandler, type SessionState } from "./event-handler"
import {
  BOULDER_CONTINUATION_PROMPT,
  ORCHESTRATOR_DELEGATION_REQUIRED,
  SINGLE_TASK_DIRECTIVE,
} from "./system-reminder-templates"
import {
  createToolExecuteAfterHandler,
  type ToolExecuteAfterInput,
  type ToolExecuteAfterOutput,
} from "./tool-execute-after"

export const HOOK_NAME = "atlas"

/**
 * Cross-platform check if a path is inside .sisyphus/ directory.
 * Handles both forward slashes (Unix) and backslashes (Windows).
 */
function isSisyphusPath(filePath: string): boolean {
  return /\.sisyphus[/\\]/.test(filePath)
}

const WRITE_EDIT_TOOLS = ["Write", "Edit", "write", "edit"]

function getLastAgentFromSession(sessionID: string): string | null {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return null
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() ?? null
}

export interface AtlasHookOptions {
  directory: string
  backgroundManager?: BackgroundManager
}

export function createAtlasHook(ctx: PluginInput, options?: AtlasHookOptions) {
  const backgroundManager = options?.backgroundManager
  const sessions = new Map<string, SessionState>()
  const pendingFilePaths = new Map<string, string>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  async function injectContinuation(
    sessionID: string,
    planName: string,
    tasksPath: string,
    remaining: number,
    total: number,
    agent?: string
  ): Promise<void> {
    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some((t) => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    const prompt =
      BOULDER_CONTINUATION_PROMPT.replace(/{PLAN_NAME}/g, planName).replace(/{TASKS_PATH}/g, tasksPath) +
      `\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting boulder continuation`, { sessionID, planName, remaining })

      let model: { providerID: string; modelID: string } | undefined
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: { model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          const msgModel = info?.model
          if (msgModel?.providerID && msgModel?.modelID) {
            model = { providerID: msgModel.providerID, modelID: msgModel.modelID }
            break
          }
          if (info?.providerID && info?.modelID) {
            model = { providerID: info.providerID, modelID: info.modelID }
            break
          }
        }
      } catch {
        const messageDir = getMessageDir(sessionID)
        const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
        model =
          currentMessage?.model?.providerID && currentMessage?.model?.modelID
            ? {
                providerID: currentMessage.model.providerID,
                modelID: currentMessage.model.modelID,
              }
            : undefined
      }

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: agent ?? "atlas",
          ...(model !== undefined ? { model } : {}),
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Boulder continuation injected`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Boulder continuation failed`, { sessionID, error: String(err) })
    }
  }

  const eventHandler = createEventHandler({
    ctx,
    hookName: HOOK_NAME,
    backgroundManager,
    sessions,
    getState,
    getLastAgentFromSession,
    injectContinuation,
  })

  const toolExecuteAfterHandler = createToolExecuteAfterHandler({
    ctx,
    hookName: HOOK_NAME,
    pendingFilePaths,
    isSisyphusPath,
    writeEditTools: WRITE_EDIT_TOOLS,
  })

  return {
    handler: eventHandler,

    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      // Check Write/Edit tools for orchestrator - inject strong warning
      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
        if (filePath && !isSisyphusPath(filePath)) {
          // Store filePath for use in tool.execute.after
          if (input.callID) {
            pendingFilePaths.set(input.callID, filePath)
          }
          const warning = ORCHESTRATOR_DELEGATION_REQUIRED.replace("$FILE_PATH", filePath)
          output.message = (output.message || "") + warning
          log(`[${HOOK_NAME}] Injected delegation warning for direct file modification`, {
            sessionID: input.sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      // Check sisyphus_task - inject single-task directive and Phase enforcement (Task 9.3)
      if (input.tool === "sisyphus_task" || input.tool === "delegate_task") {
        const subagentType = (output.args.subagent_type as string | undefined)?.toLowerCase() || ""
        const prompt = output.args.prompt as string | undefined

        // Phase enforcement (Task 9.3): Block planning agents during executing phase
        const planningAgents = ["metis", "prometheus", "momus", "planner", "plan consultant", "plan reviewer"]
        const isPlanningAgent = planningAgents.some((agent) => subagentType.includes(agent))

        if (isPlanningAgent && isExecutingPhase(ctx.directory)) {
          const currentPhase = getCurrentPhase(ctx.directory)
          const phaseWarning = `

---

🛑 **PHASE ENFORCEMENT VIOLATION (Task 9.3)**

You are attempting to call a **planning agent** (${subagentType}) while in **executing phase**.

| Current Phase | Target Agent | Allowed? |
|---------------|--------------|----------|
| ${currentPhase} | ${subagentType} | ❌ NO |

**Rule**: During \`executing\` phase, planning agents (Metis, Prometheus, Momus) are blocked.

**Options:**
1. Complete current execution, then use \`/reset-phase\` to restart planning
2. If you truly need to re-plan, ask user for confirmation first
3. Continue with execution tasks instead

**Proceeding anyway, but this is a workflow violation.**

---
`
          output.message = (output.message || "") + phaseWarning
          log(`[${HOOK_NAME}] Phase enforcement warning: planning agent called during executing`, {
            sessionID: input.sessionID,
            subagentType,
            currentPhase,
          })
        }

        if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
          output.args.prompt = `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n` + prompt
          log(`[${HOOK_NAME}] Injected single-task directive to delegate_task`, {
            sessionID: input.sessionID,
          })
        }
      }
    },

    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ): Promise<void> => {
      await toolExecuteAfterHandler(input, output)
    },
  }
}
