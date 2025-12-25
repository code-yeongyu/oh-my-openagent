import pc from "picocolors"
import type { RunContext, Todo, ChildSession, SessionStatus } from "./types"

export async function checkCompletionConditions(ctx: RunContext): Promise<boolean> {
  try {
    if (!await areAllTodosComplete(ctx)) {
      return false
    }

    if (!await areAllChildrenIdle(ctx)) {
      return false
    }

    return true
  } catch (err) {
    console.error(pc.red(`[completion] API error: ${err}`))
    return false
  }
}

async function areAllTodosComplete(ctx: RunContext): Promise<boolean> {
  const todosRes = await ctx.client.session.todo({ path: { id: ctx.sessionID } })
  const todos = (todosRes.data ?? []) as Todo[]

  const incompleteTodos = todos.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled"
  )

  if (incompleteTodos.length > 0) {
    console.log(pc.dim(`  Waiting: ${incompleteTodos.length} todos remaining`))
    return false
  }

  return true
}

async function areAllChildrenIdle(ctx: RunContext): Promise<boolean> {
  const allStatuses = await fetchAllStatuses(ctx)
  return areAllDescendantsIdle(ctx, ctx.sessionID, allStatuses)
}

async function fetchAllStatuses(
  ctx: RunContext
): Promise<Record<string, SessionStatus>> {
  const statusRes = await ctx.client.session.status()
  return (statusRes.data ?? {}) as Record<string, SessionStatus>
}

async function areAllDescendantsIdle(
  ctx: RunContext,
  sessionID: string,
  allStatuses: Record<string, SessionStatus>
): Promise<boolean> {
  const childrenRes = await ctx.client.session.children({
    path: { id: sessionID },
  })
  const children = (childrenRes.data ?? []) as ChildSession[]

  for (const child of children) {
    const status = allStatuses[child.id]
    if (status && status.type !== "idle") {
      console.log(
        pc.dim(`  Waiting: session ${child.id.slice(0, 8)}... is ${status.type}`)
      )
      return false
    }

    const descendantsIdle = await areAllDescendantsIdle(
      ctx,
      child.id,
      allStatuses
    )
    if (!descendantsIdle) {
      return false
    }
  }

  return true
}
