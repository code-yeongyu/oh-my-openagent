import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getTimingConfig } from "./timing"
import { buildTaskPrompt } from "./prompt-builder"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDetailedError } from "./error-formatting"
import { getSessionTools } from "../../shared/session-tools-store"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { COUNCIL_DEFAULTS } from "../../agents/athena/constants"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../shared/question-denied-session-permission"
import { setSessionFallbackChain } from "../../hooks/model-fallback/hook"

export async function executeBackgroundTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: DelegatedModelConfig | undefined,
  systemContent: string | undefined,
  fallbackChain?: FallbackEntry[],
  isLongRunningCouncil?: boolean,
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
      writeOutputToFile: args.write_output_to_file,
      sessionPermission: QUESTION_DENIED_SESSION_PERMISSION,
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

    if (sessionId) {
      setSessionFallbackChain(sessionId, fallbackChain)
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

    const waitInstruction = isLongRunningCouncil
      ? `This task was automatically backgrounded because council sessions are long-running.
Use \`background_wait(task_ids=["${task.id}"], timeout=${COUNCIL_DEFAULTS.BACKGROUND_WAIT_TIMEOUT_MS})\` to block until completion, then \`background_output(task_id="${task.id}")\` to retrieve the result.
Do NOT poll background_output repeatedly \u2014 background_wait will return when the task finishes. Note: all timeouts are in milliseconds (ms).`
      : `System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.`

    const taskMetadataBlock = sessionId
      ? `\n\n<task_metadata>\nsession_id: ${sessionId}\ntask_id: ${task.id}\nbackground_task_id: ${task.id}\n</task_metadata>`
      : ""

    return `Background task launched.

Background Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}${args.category ? ` (category: ${args.category})` : ""}
Status: ${task.status}

${waitInstruction}${taskMetadataBlock}`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Launch background task",
      args,
      agent: agentToUse,
      category: args.category,
    })
  }
}
