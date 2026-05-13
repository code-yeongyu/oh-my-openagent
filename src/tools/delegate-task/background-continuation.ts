import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import { formatDetailedError } from "./error-formatting"
import { getSessionTools } from "../../shared/session-tools-store"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { resolveMetadataModel } from "./resolve-metadata-model"
import { getTaskID } from "./task-id"

export async function executeBackgroundContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  systemContent?: string
): Promise<string> {
  const { manager } = executorCtx
  const taskID = getTaskID(args)

  try {
    if (!taskID) {
      throw new Error("task_id is required to continue a background task")
    }

    const effectivePrompt = systemContent
      ? `${systemContent}\n\n${args.prompt}`
      : args.prompt

    const task = await manager.resume({
      sessionId: taskID,
      prompt: effectivePrompt,
      parentSessionId: parentContext.sessionID,
      parentMessageId: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      parentTools: getSessionTools(parentContext.sessionID),
    })
    const sessionId = task.sessionId
    const backgroundTaskId = task.id
    const resolvedModel = resolveMetadataModel(task.model, parentContext.model)

    const bgContMeta = {
      title: `Continue: ${args.description}`,
      metadata: {
        prompt: args.prompt,
        agent: task.agent,
        ...(task.category !== undefined ? { category: task.category } : {}),
        ...(args.requested_subagent_type !== undefined ? { requested_subagent_type: args.requested_subagent_type } : {}),
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: sessionId,
        backgroundTaskId,
        sessionId,
        command: args.command,
        model: resolvedModel,
      },
    }
    await publishToolMetadata(ctx, bgContMeta)

    return `Background task continued.

Task ID: ${backgroundTaskId}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
System notifies on completion. Use \`background_output\` with task_id="${backgroundTaskId}" to check.

Do NOT call background_output now. Wait for <system-reminder> notification first.

${buildTaskMetadataBlock({
      sessionId,
      taskId: sessionId,
      backgroundTaskId,
      agent: task.agent,
      category: task.category,
    })}`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Continue background task",
      args,
      sessionID: taskID,
    })
  }
}
