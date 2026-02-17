import type { MergedPlan } from "../schemas/merged-plan-schema"
import type { Task } from "../schemas/sub-plan-schema"

export function serializeToSisyphusMarkdown(merged: MergedPlan): string {
  const sections: string[] = []

  sections.push(`# ${merged.title}`)
  sections.push("")
  sections.push(generateTldr(merged))
  sections.push("")
  sections.push("---")
  sections.push("")
  sections.push(generateContext(merged))
  sections.push("")
  sections.push("---")
  sections.push("")
  sections.push(generateWorkObjectives(merged))
  sections.push("")
  sections.push("---")
  sections.push("")
  sections.push(generateExecutionStrategy(merged))
  sections.push("")
  sections.push("---")
  sections.push("")
  sections.push(generateTodos(merged))
  sections.push("")
  sections.push("---")
  sections.push("")
  sections.push(generateSuccessCriteria(merged))

  return sections.join("\n")
}

function generateTldr(plan: MergedPlan): string {
  const lines: string[] = []
  lines.push("## TL;DR")
  lines.push("")
  lines.push(`> **Quick Summary**: ${plan.domains.join(", ")}`)
  lines.push(">")
  lines.push("> **Deliverables**:")
  for (const domain of plan.domains) {
    lines.push(`> - ${domain}`)
  }
  lines.push(">")
  lines.push(`> **Estimated Effort**: ${estimateEffort(plan.tasks.length)}`)
  lines.push(`> **Parallel Execution**: ${plan.waves.length > 1 ? `YES - ${plan.waves.length} waves` : "NO - sequential"}`)
  lines.push(`> **Critical Path**: ${generateCriticalPath(plan)}`)
  return lines.join("\n")
}

function estimateEffort(taskCount: number): string {
  if (taskCount <= 3) return "Quick"
  if (taskCount <= 7) return "Short"
  if (taskCount <= 15) return "Medium"
  if (taskCount <= 25) return "Large"
  return "XL"
}

function generateCriticalPath(plan: MergedPlan): string {
  if (plan.tasks.length === 0) return "None"
  const roots = plan.tasks.filter((t) => t.depends_on.length === 0)
  const leaves = plan.tasks.filter((t) => !plan.tasks.some((other) => other.depends_on.includes(t.id)))
  if (roots.length === 0 || leaves.length === 0) return plan.tasks.map((t) => t.id).join(" → ")
  return `${roots[0].id} → ... → ${leaves[0].id}`
}

function generateContext(plan: MergedPlan): string {
  const lines: string[] = []
  lines.push("## Context")
  lines.push("")
  lines.push(plan.context)
  lines.push("")
  lines.push("**Domains Covered**:")
  for (const domain of plan.domains) {
    lines.push(`- ${domain}`)
  }
  return lines.join("\n")
}

function generateWorkObjectives(plan: MergedPlan): string {
  const lines = ["## Work Objectives", ""]
  const tasksPerDomain = Math.ceil(plan.tasks.length / (plan.domains.length || 1))
  for (const domain of plan.domains) {
    lines.push(`- **${domain}**: ${tasksPerDomain} task${tasksPerDomain !== 1 ? "s" : ""}`)
  }
  return lines.join("\n")
}

function generateExecutionStrategy(plan: MergedPlan): string {
  const lines: string[] = []
  lines.push("## Execution Strategy")
  lines.push("")
  lines.push(`**Total Waves**: ${plan.waves.length}`)
  lines.push(`**Total Tasks**: ${plan.tasks.length}`)
  lines.push("")
  lines.push("**Global Constraints**:")
  lines.push(plan.global_constraints)
  lines.push("")

  if (plan.conflicts_resolved && plan.conflicts_resolved.length > 0) {
    lines.push("**Conflicts Resolved**:")
    for (const conflict of plan.conflicts_resolved) {
      lines.push(`- ${conflict}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function generateTodos(plan: MergedPlan): string {
  const lines: string[] = []
  lines.push("## TODOs")
  lines.push("")

  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]))

  for (const wave of plan.waves) {
    lines.push(`### Wave ${wave.wave}`)
    lines.push("")

    for (const taskId of wave.task_ids) {
      const task = taskMap.get(taskId)
      if (!task) continue

      lines.push(`- [ ] ${task.id}. ${task.title}`)
      lines.push("")
      lines.push(`  **What to do**: ${task.description}`)
      lines.push("")
      lines.push(`  **Category**: \`${task.category}\``)
      lines.push(`  **Skills**: ${task.skills.length > 0 ? task.skills.join(", ") : "none"}`)
      lines.push(`  **Files**: ${task.files_touched.join(", ")}`)
      lines.push(`  **Depends on**: ${task.depends_on.length > 0 ? task.depends_on.join(", ") : "none"}`)
      lines.push("")
      lines.push("  **Acceptance Criteria**:")
      for (const ac of task.acceptance_criteria) {
        lines.push(`  - [ ] ${ac}`)
      }
      lines.push("")

      if (task.must_not_do && task.must_not_do.length > 0) {
        lines.push("  **Must NOT do**:")
        for (const mnd of task.must_not_do) {
          lines.push(`  - ${mnd}`)
        }
        lines.push("")
      }

      lines.push("  ---")
      lines.push("")
    }
  }

  return lines.join("\n")
}

function generateSuccessCriteria(plan: MergedPlan): string {
  const lines: string[] = []
  lines.push("## Success Criteria")
  lines.push("")

  const allCriteria = new Set<string>()
  for (const task of plan.tasks) {
    for (const ac of task.acceptance_criteria) {
      allCriteria.add(ac)
    }
  }

  for (const criterion of allCriteria) {
    lines.push(`- [ ] ${criterion}`)
  }

  return lines.join("\n")
}
