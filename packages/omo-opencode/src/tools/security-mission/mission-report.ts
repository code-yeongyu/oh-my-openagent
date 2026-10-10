import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { ZodError } from "zod"
import type { MissionStore } from "../../features/security-mission"
import { GenerateReportInputSchema } from "../../features/security-mission/types"
import { generateReport } from "../../features/security-mission/disclosure-report"

export function createSecurityMissionReportTool(
  store: MissionStore,
): ToolDefinition {
  return tool({
    description: `Generate a security mission report.

Formats:
- "summary": findings table + verified finding details
- "disclosure": coordinated disclosure draft (verified findings only, with provenance gate metadata)

Disclosure drafts include only verified findings (tool-backed evidence).
A human must review and send the disclosure. Do not send automatically.`,
    args: {
      mission_id: tool.schema.string().describe("Mission ID"),
      format: tool.schema
        .enum(["summary", "disclosure"])
        .optional()
        .describe("Report format (default: summary)"),
    },
    execute: async (args) => {
      try {
        const input = GenerateReportInputSchema.parse({
          mission_id: args.mission_id,
          format: args.format ?? "summary",
        })
        const mission = store.getMission(input.mission_id)
        if (!mission) {
          return JSON.stringify({ error: "mission_not_found" })
        }
        const report = generateReport(mission, input.format)
        return JSON.stringify({
          report,
          format: input.format,
          mission_id: mission.id,
          finding_count: mission.findings.length,
          verified_count: mission.findings.filter((f) => f.status === "verified").length,
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
