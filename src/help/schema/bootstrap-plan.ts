import { z } from "zod"

/**
 * Help JSON schema for the `bootstrap-plan` surface.
 * Defines the structure of bootstrap/init plan output.
 */
export const BootstrapStepSchema = z
  .object({
    id: z.string().describe("Step identifier"),
    title: z.string().describe("Step display title"),
    description: z.string().describe("Step description"),
    status: z.enum(["pending", "in_progress", "completed", "skipped", "failed"]).describe("Step execution status"),
    duration: z.number().nullable().optional().describe("Step execution duration in ms"),
    error: z.string().nullable().optional().describe("Error message if failed"),
  })
  .meta({ ref: "BootstrapStep" })

export const BootstrapPlanSchema = z
  .object({
    version: z.string().describe("Plan version"),
    createdAt: z.number().describe("Plan creation timestamp (epoch ms)"),
    completedAt: z.number().nullable().optional().describe("Completion timestamp (epoch ms)"),
    totalSteps: z.number().describe("Total number of steps"),
    completedSteps: z.number().describe("Number of completed steps"),
    steps: z.array(BootstrapStepSchema).describe("Bootstrap steps"),
    summary: z.string().optional().describe("Overall summary of the bootstrap plan"),
  })
  .meta({ ref: "BootstrapPlan" })

export const BootstrapPlanResultSchema = z
  .object({
    plan: BootstrapPlanSchema.describe("The bootstrap plan"),
    timestamp: z.number().describe("Snapshot timestamp (epoch ms)"),
  })
  .meta({ ref: "BootstrapPlanResult" })

export type BootstrapStep = z.infer<typeof BootstrapStepSchema>
export type BootstrapPlan = z.infer<typeof BootstrapPlanSchema>
export type BootstrapPlanResult = z.infer<typeof BootstrapPlanResultSchema>
