import type { BackgroundManager } from "../../features/background-agent"

interface CompactingInput {
  sessionID: string
}

interface CompactingOutput {
  context: string[]
  prompt?: string
}

/**
 * Background agent compaction hook - preserves task state during context compaction.
 * 
 * When OpenCode compacts session context to save tokens, this hook injects
 * information about running and recently completed background tasks so the
 * agent doesn't lose awareness of delegated work.
 */
export function createBackgroundCompactionHook(manager: BackgroundManager) {
  return {
    "experimental.session.compacting": async (
      input: CompactingInput,
      output: CompactingOutput
    ): Promise<void> => {
      const { sessionID } = input

      // Get running tasks for this session
      const running = manager.getRunningTasks()
        .filter(t => t.parentSessionID === sessionID)
        .map(t => ({
          id: t.id,
          agent: t.agent,
          description: t.description,
          startedAt: t.startedAt,
        }))

      // Get recently completed tasks (still in memory within 5-min retention)
      const completed = manager.getCompletedTasks()
        .filter(t => t.parentSessionID === sessionID)
        .slice(-10) // Last 10 completed
        .map(t => ({
          id: t.id,
          agent: t.agent,
          description: t.description,
          status: t.status,
        }))

      // Early exit if nothing to preserve
      if (running.length === 0 && completed.length === 0) return

      const sections: string[] = ["<background-tasks>"]

      // Running tasks section
      if (running.length > 0) {
        sections.push("## Running Background Tasks")
        sections.push("")
        for (const t of running) {
          const elapsed = t.startedAt 
            ? Math.floor((Date.now() - t.startedAt.getTime()) / 1000)
            : 0
          sections.push(`- **\`${t.id}\`** (${t.agent}): ${t.description} [${elapsed}s elapsed]`)
        }
        sections.push("")
        sections.push("> **Note:** You WILL be notified when tasks complete.")
        sections.push("> Do NOT poll - continue productive work.")
        sections.push("")
      }

      // Completed tasks section
      if (completed.length > 0) {
        sections.push("## Recently Completed Tasks")
        sections.push("")
        for (const t of completed) {
          const statusEmoji = t.status === "completed" ? "✅" : t.status === "error" ? "❌" : "⏱️"
          sections.push(`- ${statusEmoji} **\`${t.id}\`**: ${t.description}`)
        }
        sections.push("")
      }

      sections.push("## Retrieval")
      sections.push('Use `background_output(task_id="<id>")` to retrieve task results.')
      sections.push("</background-tasks>")

      output.context.push(sections.join("\n"))
    }
  }
}
