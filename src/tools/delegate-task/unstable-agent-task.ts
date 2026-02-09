import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext, SessionMessage } from "./executor-types"
import { getTimingConfig } from "./timing"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDuration } from "./time-formatter"
import { formatDetailedError } from "./error-formatting"

export async function executeUnstableAgentTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined,
  systemContent: string | undefined,
  actualModel: string | undefined
): Promise<string> {
  const { manager, client } = executorCtx

  try {
    const task = await manager.launch({
      description: args.description,
      prompt: args.prompt,
      agent: agentToUse,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      model: categoryModel,
      skills: args.load_skills.length > 0 ? args.load_skills : undefined,
      skillContent: systemContent,
      category: args.category,
    })

    const timing = getTimingConfig()
    const waitStart = Date.now()
    let sessionID = task.sessionID
    while (!sessionID && Date.now() - waitStart < timing.WAIT_FOR_SESSION_TIMEOUT_MS) {
      if (ctx.abort?.aborted) {
        return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
      }
      await new Promise(resolve => setTimeout(resolve, timing.WAIT_FOR_SESSION_INTERVAL_MS))
      const updated = manager.getTask(task.id)
      sessionID = updated?.sessionID
    }
    if (!sessionID) {
      return formatDetailedError(new Error(`Task failed to start within timeout (30s). Task ID: ${task.id}, Status: ${task.status}`), {
        operation: "Launch monitored background task",
        args,
        agent: agentToUse,
        category: args.category,
      })
    }

    const bgTaskMeta = {
      title: args.description,
      metadata: {
        prompt: args.prompt,
        agent: agentToUse,
        category: args.category,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: sessionID,
        command: args.command,
      },
    }
    await ctx.metadata?.(bgTaskMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, bgTaskMeta)
    }

    const startTime = new Date()
    const timingCfg = getTimingConfig()
    const pollStart = Date.now()
    let lastMsgCount = 0
    let stablePolls = 0

    while (Date.now() - pollStart < timingCfg.MAX_POLL_TIME_MS) {
      if (ctx.abort?.aborted) {
        return `Task aborted (was running in background mode).\n\nSession ID: ${sessionID}`
      }

      await new Promise(resolve => setTimeout(resolve, timingCfg.POLL_INTERVAL_MS))

      const statusResult = await client.session.status()
      const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
      const sessionStatus = allStatuses[sessionID]

      if (sessionStatus && sessionStatus.type !== "idle") {
        stablePolls = 0
        lastMsgCount = 0
        continue
      }

      if (Date.now() - pollStart < timingCfg.MIN_STABILITY_TIME_MS) continue

      const messagesCheck = await client.session.messages({ path: { id: sessionID } })
      const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
      const currentMsgCount = msgs.length

      if (currentMsgCount === lastMsgCount) {
        stablePolls++
        if (stablePolls >= timingCfg.STABILITY_POLLS_REQUIRED) break
      } else {
        stablePolls = 0
        lastMsgCount = currentMsgCount
      }
    }

    const messagesResult = await client.session.messages({ path: { id: sessionID } })
    const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as SessionMessage[]

    const assistantMessages = messages
      .filter((m) => m.info?.role === "assistant")
      .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
    const lastMessage = assistantMessages[0]

    if (!lastMessage) {
      return `No assistant response found (task ran in background mode).\n\nSession ID: ${sessionID}`
    }

    const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
    const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
    const duration = formatDuration(startTime)

    return `SUPERVISED TASK COMPLETED SUCCESSFULLY

IMPORTANT: This model (${actualModel}) is marked as unstable/experimental.
Your run_in_background=false was automatically converted to background mode for reliability monitoring.

Duration: ${duration}
Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

MONITORING INSTRUCTIONS:
- The task was monitored and completed successfully
- If you observe this agent behaving erratically in future calls, actively monitor its progress
- Use background_cancel(task_id="...") to abort if the agent seems stuck or producing garbage output
- Do NOT retry automatically if you see this message - the task already succeeded

---

RESULT:

${textContent || "(No text output)"}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Launch monitored background task",
      args,
      agent: agentToUse,
      category: args.category,
    })
  }
}
