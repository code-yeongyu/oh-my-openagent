import { MergedPlanSchema, type MergedPlan } from "../schemas/merged-plan-schema"
import { detectCycles } from "./cycle-detector"

export interface FinalValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateMergedPlan(plan: MergedPlan): FinalValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Schema validation
  const schema = MergedPlanSchema.safeParse(plan)
  if (!schema.success) {
    for (const issue of schema.error.issues) {
      errors.push(`Schema: ${issue.path.join(".")}: ${issue.message}`)
    }
  }

  // Guard for malformed input — remaining checks need arrays/objects
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
  const waves = Array.isArray(plan.waves) ? plan.waves : []
  const graph =
    plan.dependency_graph && typeof plan.dependency_graph === "object"
      ? plan.dependency_graph
      : {}

  // 2. Cycle detection
  const cycles = detectCycles(graph)
  for (const cycle of cycles) {
    errors.push(`Dependency cycle detected: ${cycle.join(" → ")}`)
  }

  // Build lookups
  const taskWave = new Map<string, number>()
  for (const wave of waves) {
    for (const id of wave.task_ids) {
      taskWave.set(id, wave.wave)
    }
  }
  const taskIds = new Set(tasks.map((t) => t.id))

  // 3. Wave ordering: task wave must be strictly AFTER all deps' waves
  for (const task of tasks) {
    const myWave = taskWave.get(task.id)
    if (myWave === undefined) continue
    for (const dep of task.depends_on ?? []) {
      const depWave = taskWave.get(dep)
      if (depWave !== undefined && myWave <= depWave) {
        errors.push(
          `Task "${task.id}" in wave ${myWave} depends on "${dep}" in wave ${depWave} — invalid wave ordering`
        )
      }
    }
  }

  // 4. Task completeness: ≥1 acceptance criterion
  for (const task of tasks) {
    if (!task.acceptance_criteria || task.acceptance_criteria.length === 0) {
      errors.push(`Task "${task.id}" has no acceptance criteria`)
    }
  }

  // 5. Orphan tasks: wave task_ids must exist in tasks array
  for (const wave of waves) {
    for (const id of wave.task_ids) {
      if (!taskIds.has(id)) {
        errors.push(`Wave ${wave.wave} references unknown task "${id}"`)
      }
    }
  }

  // 6. Unassigned tasks: tasks not in any wave → warning
  const assigned = new Set<string>()
  for (const wave of waves) {
    for (const id of wave.task_ids) {
      assigned.add(id)
    }
  }
  for (const task of tasks) {
    if (!assigned.has(task.id)) {
      warnings.push(`Task "${task.id}" is not assigned to any wave`)
    }
  }

  // 7. Same-wave file overlap → warning
  for (const wave of waves) {
    const fileToTasks = new Map<string, string[]>()
    for (const id of wave.task_ids) {
      const task = tasks.find((t) => t.id === id)
      if (!task) continue
      for (const file of task.files_touched ?? []) {
        const list = fileToTasks.get(file) ?? []
        list.push(id)
        fileToTasks.set(file, list)
      }
    }
    for (const [file, touching] of fileToTasks) {
      if (touching.length >= 2) {
        warnings.push(
          `File "${file}" touched by ${touching.join(", ")} in wave ${wave.wave} — parallel conflict`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
