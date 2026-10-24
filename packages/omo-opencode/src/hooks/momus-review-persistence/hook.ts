import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

import { hashPlanContent, writeMomusReviewArtifact } from "../../features/boulder-state"
import { log } from "../../shared"
import {
  extractSinglePlanPath,
  parseMomusVerdict,
  readReviewMetadata,
  resolveSessionReviewContext,
} from "./review-resolution"

const TASK_TOOLS = new Set(["task", "Task", "task_tool", "call_omo_agent"])
const BACKGROUND_OUTPUT_TOOL = "background_output"
const MAX_TRACKED_CALLS = 500

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
  args?: Record<string, unknown>
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

export function createMomusReviewPersistenceHook(ctx: PluginInput) {
  const callStartedAt = new Map<string, number>()

  const toolExecuteBefore = async (input: ToolExecuteInput, _output: { args: Record<string, unknown> }) => {
    if (!TASK_TOOLS.has(input.tool) && input.tool !== BACKGROUND_OUTPUT_TOOL) {
      return
    }
    if (callStartedAt.size >= MAX_TRACKED_CALLS) {
      callStartedAt.clear()
    }
    callStartedAt.set(`${input.sessionID}:${input.callID}`, Date.now())
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const startedAt = callStartedAt.get(`${input.sessionID}:${input.callID}`)
    callStartedAt.delete(`${input.sessionID}:${input.callID}`)

    try {
      const isTaskSurface = TASK_TOOLS.has(input.tool)
      const isBackgroundSurface = input.tool === BACKGROUND_OUTPUT_TOOL
      if (!isTaskSurface && !isBackgroundSurface) {
        return
      }

      const metadata = readReviewMetadata(output.metadata, input.args)
      if (metadata.agent !== "momus") {
        return
      }

      const verdict = parseMomusVerdict(output.output ?? "")
      if (!verdict) {
        return
      }

      let promptText = metadata.prompt
      let model = metadata.model
      let sessionDurationMs: number | undefined
      if (metadata.sessionId && (!promptText || !model || isBackgroundSurface)) {
        const sessionContext = await resolveSessionReviewContext(ctx.client, metadata.sessionId)
        promptText ??= sessionContext.promptText
        model ??= sessionContext.model
        sessionDurationMs = sessionContext.durationMs
      }
      if (!promptText) {
        return
      }

      const planPath = extractSinglePlanPath(promptText)
      if (!planPath) {
        log("[momus-review-persistence] Skipped: prompt does not reference exactly one plan file", {
          sessionID: input.sessionID,
          callID: input.callID,
        })
        return
      }

      const planFilePath = isAbsolute(planPath) ? planPath : join(ctx.directory, planPath)
      let planHash: string | undefined
      if (existsSync(planFilePath)) {
        planHash = hashPlanContent(readFileSync(planFilePath, "utf-8"))
      }

      const measuredDurationMs = isTaskSurface && startedAt !== undefined ? Date.now() - startedAt : undefined

      const writtenPath = writeMomusReviewArtifact(ctx.directory, planPath, {
        verdict,
        reviewedAt: new Date(),
        model,
        planHash,
        durationMs: sessionDurationMs ?? measuredDurationMs,
        sessionId: metadata.sessionId,
        reviewerOutput: output.output,
      })
      if (writtenPath) {
        log("[momus-review-persistence] Persisted Momus review artifact", { path: writtenPath, verdict })
      }
    } catch (error) {
      log("[momus-review-persistence] Failed to persist Momus review artifact", { error })
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  }
}
