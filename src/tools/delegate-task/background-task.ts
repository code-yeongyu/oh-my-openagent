import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getTimingConfig } from "./timing"
import { buildTaskPrompt } from "./prompt-builder"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDetailedError } from "./error-formatting"
import { getSessionTools } from "../../shared/session-tools-store"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

export async function executeBackgroundTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined,
  systemContent: string | undefined,
  fallbackChain?: FallbackEntry[],
): Promise<string> {
  const { manager } = executorCtx

  try {
    const effectivePrompt = buildTaskPrompt(args.prompt, agentToUse)
    const task = await manager.launch({
      description: args.description,
      prompt: effectivePrompt,
      agent: agentToUse,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      parentTools: getSessionTools(parentContext.sessionID),
      model: categoryModel,
      fallbackChain,
      skills: args.load_skills.length > 0 ? args.load_skills : undefined,
      skillContent: systemContent,
      category: args.category,
    })

    // OpenCode TUI's `Task` tool UI calculates toolcalls by looking up
    // `props.metadata.sessionId` and then counting tool parts in that session.
    // BackgroundManager.launch() returns immediately (pending) before the session exists,
    // so we must wait briefly for the session to be created to set metadata correctly.
    const timing = getTimingConfig()
    const waitStart = Date.now()
    let sessionId = task.sessionID
    while (!sessionId && Date.now() - waitStart < timing.WAIT_FOR_SESSION_TIMEOUT_MS) {
      if (ctx.abort?.aborted) {
        return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
      }
      await new Promise(resolve => setTimeout(resolve, timing.WAIT_FOR_SESSION_INTERVAL_MS))
      const updated = manager.getTask(task.id)
      sessionId = updated?.sessionID
    }

    if (args.category && sessionId) {
      SessionCategoryRegistry.register(sessionId, args.category)
    }

    const metadata = {
      prompt: args.prompt,
      agent: task.agent,
      category: args.category,
      load_skills: args.load_skills,
      description: args.description,
      run_in_background: args.run_in_background,
      command: args.command,
      ...(sessionId ? { sessionId } : {}),
      ...(categoryModel ? { model: { providerID: categoryModel.providerID, modelID: categoryModel.modelID } } : {}),
    }

    const unstableMeta = {
      title: args.description,
      metadata,
    }
    await ctx.metadata?.(unstableMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, unstableMeta)
    }

    const taskMetadataBlock = sessionId
      ? `\n\n<task_metadata>\nsession_id: ${sessionId}\ntask_id: ${sessionId}\nbackground_task_id: ${task.id}\n</task_metadata>`
      : ""

    return `Background task launched.

Background Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}${args.category ? ` (category: ${args.category})` : ""}
Status: ${task.status}

System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.${taskMetadataBlock}`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Launch background task",
      args,
      agent: agentToUse,
      category: args.category,
    })
  }
}
