import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { executeBackgroundTask } from "./background-task"

/** Splits `items` into `split` contiguous slices as even as possible, the first slices taking the extra item. */
export function partitionItems<T>(items: readonly T[], split: number | undefined): T[][] {
  if (items.length === 0) return []
  const count = Math.min(items.length, Math.max(1, Math.floor(split ?? items.length)))
  const base = Math.floor(items.length / count)
  const extra = items.length % count
  const slices: T[][] = []
  let start = 0
  for (let index = 0; index < count; index++) {
    const size = base + (index < extra ? 1 : 0)
    slices.push(items.slice(start, start + size))
    start += size
  }
  return slices
}

function childPrompt(prompt: string, slice: readonly string[], first: number, total: number): string {
  const last = first + slice.length - 1
  const range = slice.length === 1 ? `item ${first} of ${total}` : `items ${first}-${last} of ${total}`
  return `${prompt}\n\nYour share of the work is ${range}. Handle only these:\n${slice.map((item) => `- ${item}`).join("\n")}`
}

/**
 * One `task` call with `items` starts one background child per slice, all with the same agent, skills and prompt.
 * The call is the group: unless it passes `wake`, its children report once, together, when the last one finishes.
 */
export async function executeFanOut(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: DelegatedModelConfig | undefined,
  systemContent: string | undefined,
  fallbackChain?: FallbackEntry[],
): Promise<string> {
  const items = args.items ?? []
  const slices = partitionItems(items, args.split)
  const { manager } = executorCtx
  const groupId = args.wake === undefined ? `grp_${crypto.randomUUID().slice(0, 8)}` : undefined
  if (groupId) manager.registerTaskGroup(groupId, { size: slices.length, parentSessionId: parentContext.sessionID })

  let first = 1
  const launches = slices.map((slice, index) => {
    const childArgs: DelegateTaskArgs = {
      ...args,
      items: undefined,
      split: undefined,
      run_in_background: true,
      prompt: childPrompt(args.prompt, slice, first, items.length),
      description: `${args.description} [${index + 1}/${slices.length}]`,
      ...(groupId ? { groupId } : {}),
    }
    first += slice.length
    return executeBackgroundTask(
      childArgs,
      ctx,
      executorCtx,
      parentContext,
      agentToUse,
      categoryModel,
      systemContent,
      fallbackChain,
    )
  })
  const outputs = await Promise.all(launches)

  const children = manager
    .getTasksByParentSession(parentContext.sessionID)
    .filter((task) => (groupId ? task.groupId === groupId : outputs.some((output) => output.includes(task.id))))
  if (groupId) manager.settleTaskGroupSize(groupId, children.length)

  const reporting = groupId
    ? `They report together, in one notification with every child's result, once the last of them finishes (group \`${groupId}\`).`
    : args.wake === "none"
      ? "Each child's result waits for your next turn."
      : "Each child reports on its own as it finishes."
  const failed = slices.length - children.length
  return `Fan-out launched: ${children.length} background task${children.length === 1 ? "" : "s"} over ${items.length} item${items.length === 1 ? "" : "s"}.
${children.map((task) => `- \`${task.id}\`: ${task.description}`).join("\n")}${failed > 0 ? `\n${failed} child${failed === 1 ? "" : "ren"} failed to launch:\n${outputs.filter((output) => !children.some((task) => output.includes(task.id))).join("\n\n")}` : ""}

${reporting} Do not poll. Stop one with \`background_cancel(taskId="<id>")\`.${continueBlock(children)}`
}

/* The task-resume-info hook would append one child's session only; listing each child here makes it skip the call. */
function continueBlock(children: ReadonlyArray<{ id: string; sessionId?: string }>): string {
  if (children.length === 0) return ""
  const lines = children.map((task) =>
    task.sessionId
      ? `- \`${task.id}\`: task(task_id="${task.sessionId}", load_skills=[], run_in_background=true, prompt="...")`
      : `- \`${task.id}\`: not started yet; its session id comes with its notice`,
  )
  return `\n\nto continue: each child keeps its own session\n${lines.join("\n")}`
}
