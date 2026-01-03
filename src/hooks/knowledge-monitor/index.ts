import { ConflictHandler } from "./conflict-handler"
import {
  decideInterruption,
  extractFilePath,
  extractContent,
  extractEditParams,
  extractEdits,
  extractCommand,
} from "./interruption"
import { MONITORED_TOOLS, HOOK_NAME } from "./constants"
import type { KnowledgeMonitorConfig, PendingToolCall, MonitorContext } from "./types"
import type { KnowledgeCommit } from "../../features/knowledge-repo/types"

const pendingCalls = new Map<string, PendingToolCall>()
const PENDING_CALL_TTL = 60_000

let cleanupIntervalStarted = false

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callId, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callId)
    }
  }
}

export interface KnowledgeMonitorHook {
  setActiveKnowledge: (knowledge: KnowledgeCommit[]) => void
  getActiveKnowledge: () => KnowledgeCommit[]
  hooks: {
    "tool.execute.before": (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>
    "tool.execute.after": (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>
  }
}

export function createKnowledgeMonitorHook(
  projectRoot: string,
  config?: KnowledgeMonitorConfig
): KnowledgeMonitorHook {
  const handler = new ConflictHandler(projectRoot)
  const enabled = config?.enabled ?? true
  const checkPreTool = config?.checkPreTool ?? true
  const checkPostTool = config?.checkPostTool ?? false

  if (!cleanupIntervalStarted) {
    cleanupIntervalStarted = true
    setInterval(cleanupOldPendingCalls, 10_000)
  }

  return {
    setActiveKnowledge: (knowledge: KnowledgeCommit[]) => {
      handler.setActiveKnowledge(knowledge)
    },

    getActiveKnowledge: () => handler.getActiveKnowledge(),

    hooks: {
      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: Record<string, unknown> }
      ): Promise<void> => {
        if (!enabled) return

        const toolLower = input.tool.toLowerCase()
        if (!MONITORED_TOOLS.includes(toolLower as typeof MONITORED_TOOLS[number])) {
          return
        }

        const context: MonitorContext = {
          projectRoot,
          sessionId: input.sessionID,
          toolName: toolLower,
          callId: input.callID,
        }

        const filePath = extractFilePath(output.args)
        const content = extractContent(output.args)
        const { oldString, newString } = extractEditParams(output.args)
        const edits = extractEdits(output.args)
        const command = extractCommand(output.args)

        const pendingCall: PendingToolCall = {
          context,
          filePath,
          content,
          oldString,
          newString,
          edits,
          command,
          timestamp: Date.now(),
        }

        pendingCalls.set(input.callID, pendingCall)

        if (!checkPreTool) return

        const report = await handler.checkPendingCall(pendingCall)
        if (!report) return

        const decision = decideInterruption(report)
        if (decision.shouldBlock) {
          throw new Error(decision.message)
        }
      },

      "tool.execute.after": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { title: string; output: string; metadata: unknown }
      ): Promise<void> => {
        if (!enabled) return

        const pendingCall = pendingCalls.get(input.callID)
        if (!pendingCall) return

        pendingCalls.delete(input.callID)

        if (!checkPostTool) return

        const outputLower = output.output.toLowerCase()
        const isToolFailure =
          outputLower.includes("error:") ||
          outputLower.includes("failed to") ||
          outputLower.includes("could not") ||
          outputLower.startsWith("error")

        if (isToolFailure) return

        const report = await handler.checkPendingCall(pendingCall)
        if (!report) return

        const decision = decideInterruption(report)
        if (decision.shouldInterrupt) {
          output.output += `\n\n${decision.message}`
        }
      },
    },
  }
}

export { HOOK_NAME }
export type { KnowledgeMonitorConfig } from "./types"
