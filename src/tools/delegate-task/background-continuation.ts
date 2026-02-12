import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDetailedError } from "./error-formatting"

export async function executeBackgroundContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext
): Promise<string> {
  const { manager } = executorCtx

  try {
    const task = await manager.resume({
      sessionId: args.session_id!,
      prompt: args.prompt,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
    })

    const bgContMeta = {
      title: `Continue: ${task.description}`,
      metadata: {
        prompt: args.prompt,
        agent: task.agent,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: task.sessionID,
        command: args.command,
      },
    }
    await ctx.metadata?.(bgContMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, bgContMeta)
    }

    return `Background task continued.

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
Use \`background_output\` with task_id="${task.id}" to check progress.

<task_metadata>
session_id: ${task.sessionID}
${task.agent ? `subagent: ${task.agent}\n` : ""}</task_metadata>`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Continue background task",
      args,
      sessionID: args.session_id,
    })
  }
}
