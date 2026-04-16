import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import { formatDetailedError } from "./error-formatting"
import { getSessionTools } from "../../shared/session-tools-store"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { getTaskID } from "./task-id"

export async function executeBackgroundContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext
): Promise<string> {
  const { manager } = executorCtx

  try {
    const taskID = getTaskID(args)
    if (!taskID) {
      throw new Error("task_id is required to continue a background task")
    }

    const task = await manager.resume({
      sessionId: taskID,
      prompt: args.prompt,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      parentTools: getSessionTools(parentContext.sessionID),
    })

    const bgContMeta = {
      title: `Continue: ${task.description}`,
      metadata: {
        prompt: args.prompt,
        agent: task.agent,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: task.sessionID,
        backgroundTaskId: task.id,
        sessionId: task.sessionID,
        command: args.command,
        model: task.model ? { providerID: task.model.providerID, modelID: task.model.modelID } : undefined,
      },
    }
    await publishToolMetadata(ctx, bgContMeta)

    return `Background task continued.

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.

Do NOT call background_output now. Wait for <system-reminder> notification first.

${buildTaskMetadataBlock({
      sessionId: task.sessionID,
      taskId: task.sessionID,
      backgroundTaskId: task.id,
      agent: task.agent,
    })}`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Continue background task",
      args,
      sessionID: getTaskID(args),
    })
  }
}
