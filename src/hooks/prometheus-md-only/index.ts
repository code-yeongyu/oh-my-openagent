import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { HOOK_NAME, PROMETHEUS_AGENTS, ALLOWED_EXTENSIONS, ALLOWED_PATH_PREFIX, BLOCKED_TOOLS, PLANNING_CONSULT_WARNING } from "./constants"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"

export * from "./constants"

function isAllowedFile(filePath: string): boolean {
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => filePath.endsWith(ext))
  const isInAllowedPath = filePath.includes(ALLOWED_PATH_PREFIX)
  return hasAllowedExtension && isInAllowedPath
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

const TASK_TOOLS = ["sisyphus_task", "task", "call_omo_agent"]

function getAgentFromSession(sessionID: string): string | undefined {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return undefined
  return findNearestMessageWithFields(messageDir)?.agent
}

export function createPrometheusMdOnlyHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = getAgentFromSession(input.sessionID)
      
      if (!agentName || !PROMETHEUS_AGENTS.includes(agentName)) {
        return
      }

      const toolName = input.tool

      // Inject read-only warning for task tools called by Prometheus
      if (TASK_TOOLS.includes(toolName)) {
        const prompt = output.args.prompt as string | undefined
        if (prompt && !prompt.includes("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]")) {
          output.args.prompt = prompt + PLANNING_CONSULT_WARNING
          log(`[${HOOK_NAME}] Injected read-only planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      if (!isAllowedFile(filePath)) {
        log(`[${HOOK_NAME}] Blocked: Prometheus can only write to .sisyphus/*.md`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        throw new Error(
          `[${HOOK_NAME}] Prometheus (Planner) can only write/edit .md files inside .sisyphus/ directory. ` +
          `Attempted to modify: ${filePath}. ` +
          `Prometheus is a READ-ONLY planner. Use /start-work to execute the plan.`
        )
      }

      log(`[${HOOK_NAME}] Allowed: .sisyphus/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
