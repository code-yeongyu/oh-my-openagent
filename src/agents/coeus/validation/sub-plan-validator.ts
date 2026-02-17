import { SubPlanSchema } from "../schemas/sub-plan-schema";
import { MIN_TASKS_PER_SUB_PLAN, MIN_ACCEPTANCE_CRITERIA_PER_TASK } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSubPlan(plan: unknown): ValidationResult {
  const errors: string[] = [];

  const parseResult = SubPlanSchema.safeParse(plan);

  if (!parseResult.success) {
    parseResult.error.issues.forEach((issue) => {
      const path = issue.path.join(".");
      errors.push(`${path || "root"}: ${issue.message}`);
    });
    return { valid: false, errors };
  }

  const subPlan = parseResult.data;

  if (subPlan.tasks.length < MIN_TASKS_PER_SUB_PLAN) {
    errors.push(
      `Sub-plan must contain at least ${MIN_TASKS_PER_SUB_PLAN} tasks, got ${subPlan.tasks.length}`
    );
  }

  for (const task of subPlan.tasks) {
    if (task.acceptance_criteria.length < MIN_ACCEPTANCE_CRITERIA_PER_TASK) {
      errors.push(
        `Task '${task.id}' must have at least ${MIN_ACCEPTANCE_CRITERIA_PER_TASK} acceptance criteria, got ${task.acceptance_criteria.length}`
      );
    }
  }

  if (!subPlan.constraints_acknowledged) {
    errors.push("Sub-plan must acknowledge global constraints");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
