import type { HandoffSection } from "../../features/handoff"

/**
 * Build the human-readable markdown body that follows the YAML frontmatter.
 *
 * Mirrors the format from `src/features/builtin-commands/templates/handoff.ts`
 * (the canonical /handoff command template). Sections are emitted only when
 * they have content, so a minimal handoff stays minimal.
 */
export function buildHandoffBody(sections: HandoffSection): string {
  //#given - the validated handoff sections
  const lines: string[] = []
  lines.push("HANDOFF CONTEXT")
  lines.push("===============")
  lines.push("")

  lines.push("USER REQUESTS (AS-IS)")
  lines.push("---------------------")
  lines.push(sections.user_requests)
  lines.push("")

  lines.push("GOAL")
  lines.push("----")
  lines.push(sections.goal)
  lines.push("")

  lines.push("WORK COMPLETED")
  lines.push("--------------")
  for (const item of sections.work_completed) {
    lines.push(`- ${item}`)
  }
  lines.push("")

  lines.push("CURRENT STATE")
  lines.push("-------------")
  lines.push(sections.current_state)
  lines.push("")

  if (sections.pending_tasks && sections.pending_tasks.length > 0) {
    lines.push("PENDING TASKS")
    lines.push("-------------")
    for (const item of sections.pending_tasks) {
      lines.push(`- ${item}`)
    }
    lines.push("")
  }

  if (sections.key_files && sections.key_files.length > 0) {
    lines.push("KEY FILES")
    lines.push("---------")
    for (const file of sections.key_files) {
      lines.push(`- ${file.path} - ${file.purpose}`)
    }
    lines.push("")
  }

  if (sections.important_decisions && sections.important_decisions.length > 0) {
    lines.push("IMPORTANT DECISIONS")
    lines.push("-------------------")
    for (const decision of sections.important_decisions) {
      lines.push(`- ${decision.decision}: ${decision.rationale}`)
    }
    lines.push("")
  }

  if (sections.explicit_constraints && sections.explicit_constraints.length > 0) {
    lines.push("EXPLICIT CONSTRAINTS")
    lines.push("--------------------")
    for (const constraint of sections.explicit_constraints) {
      lines.push(`- ${constraint}`)
    }
    lines.push("")
  }

  if (sections.context_for_continuation) {
    lines.push("CONTEXT FOR CONTINUATION")
    lines.push("------------------------")
    lines.push(sections.context_for_continuation)
    lines.push("")
  }

  //#then - trim trailing whitespace but keep the document valid
  return lines.join("\n").replace(/\n+$/, "\n")
}
