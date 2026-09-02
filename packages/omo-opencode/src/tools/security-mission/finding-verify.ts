import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { ZodError } from "zod"
import type { MissionStore } from "../../features/security-mission"
import { VerifyFindingInputSchema } from "../../features/security-mission/types"

export function createSecurityFindingVerifyTool(
  store: MissionStore,
): ToolDefinition {
  return tool({
    description: `Re-run the provenance gate on a finding.

Useful when evidence has been updated or to confirm the current provenance status.
Returns the updated gate result and finding status.`,
    args: {
      mission_id: tool.schema.string().describe("Mission ID"),
      finding_id: tool.schema.string().describe("Finding ID"),
    },
    execute: async (args) => {
      try {
        const input = VerifyFindingInputSchema.parse({
          mission_id: args.mission_id,
          finding_id: args.finding_id,
        })
        const finding = store.verifyFinding(input.mission_id, input.finding_id)
        return JSON.stringify({
          finding: {
            id: finding.id,
            title: finding.title,
            status: finding.status,
            evidence_level: finding.evidence_level,
            verified_at: finding.verified_at,
            gate: finding.verify_gate
              ? {
                  passed: finding.verify_gate.passed,
                  provenance: finding.verify_gate.provenance,
                  reasons: finding.verify_gate.reasons,
                  checked_at: finding.verify_gate.checked_at,
                }
              : undefined,
          },
        })
      } catch (error) {
        if (error instanceof ZodError) {
          return JSON.stringify({ error: "validation_error", message: error.message })
        }
        return JSON.stringify({
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
