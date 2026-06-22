/**
 * Context for formatting an error with full debugging details.
 * Used across all matrixx background task tools.
 */
export interface ErrorContext {
  operation: string
  /**
   * DelegateTaskArgs (structurally compatible — see src/tools/delegate-task/types.ts).
   * Only the fields read by formatDetailedError are required.
   */
  args?: {
    description: string
    category?: string
    subagent_type?: string
    run_in_background: boolean
    load_skills?: string[]
    session_id?: string
  }
  sessionID?: string
  agent?: string
  category?: string
}

/**
 * Format an error with detailed context for debugging.
 * Replaces the `?? "pending"` anti-pattern across matrixx background task tools.
 */
export function formatDetailedError(error: unknown, ctx: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const lines: string[] = [`${ctx.operation} failed`, "", `**Error**: ${message}`]

  if (ctx.sessionID) {
    lines.push(`**Session ID**: ${ctx.sessionID}`)
  }

  if (ctx.agent) {
    lines.push(`**Agent**: ${ctx.agent}${ctx.category ? ` (category: ${ctx.category})` : ""}`)
  }

  if (ctx.args) {
    lines.push("", "**Arguments**:")
    lines.push(`- description: "${ctx.args.description}"`)
    lines.push(`- category: ${ctx.args.category ?? "(none)"}`)
    lines.push(`- subagent_type: ${ctx.args.subagent_type ?? "(none)"}`)
    lines.push(`- run_in_background: ${ctx.args.run_in_background}`)
    lines.push(`- load_skills: [${ctx.args.load_skills?.join(", ") ?? ""}]`)
    if (ctx.args.session_id) {
      lines.push(`- session_id: ${ctx.args.session_id}`)
    }
  }

  if (stack) {
    lines.push("", "**Stack Trace**:")
    lines.push("```")
    lines.push(stack.split("\n").slice(0, 10).join("\n"))
    lines.push("```")
  }

  return lines.join("\n")
}
