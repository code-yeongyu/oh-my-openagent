import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { ZodError } from "zod"
import type { MissionStore } from "../../features/security-mission"
import { AddFindingInputSchema } from "../../features/security-mission/types"

export function createSecurityFindingAddTool(
  store: MissionStore,
): ToolDefinition {
  return tool({
    description: `Add a security finding to a mission with automatic provenance stamping.

The provenance gate runs automatically: findings backed by tool output
(kind: output/command/response/request/log/file) are stamped "verified";
findings without tool evidence are recorded but left "claimed".

Evidence levels:
- claimed: no tool evidence (model assertion only)
- source-verified: tool-backed evidence present

The gate classifies evidence by its declared kind field. A true provenance
guarantee would require a trusted execution stamp from the tool framework;
this is a first-pass filter, not a zero-trust guarantee.`,
    args: {
      mission_id: tool.schema.string().describe("Mission ID"),
      title: tool.schema.string().describe("Finding title"),
      description: tool.schema.string().describe("Finding description"),
      severity: tool.schema
        .enum(["info", "low", "medium", "high", "critical"])
        .describe("Severity level"),
      cwe: tool.schema.string().optional().describe("CWE identifier (e.g., CWE-79)"),
      cvss_vector: tool.schema
        .string()
        .optional()
        .describe("CVSS v3.1 vector string"),
      evidence: tool.schema
        .array(
          tool.schema.object({
            kind: tool.schema.string().describe("Evidence kind (output/command/response/request/log/file for tool-backed; description/note/observation for contextual)"),
            content: tool.schema.string().describe("Evidence content"),
          }),
        )
        .optional()
        .describe("Supporting evidence"),
      remediation: tool.schema.string().optional().describe("Remediation guidance"),
      references: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Reference URLs"),
      target_id: tool.schema.string().optional().describe("Target identifier"),
    },
    execute: async (args) => {
      try {
        const input = AddFindingInputSchema.parse({
          mission_id: args.mission_id,
          title: args.title,
          description: args.description,
          severity: args.severity,
          cwe: args.cwe,
          cvss_vector: args.cvss_vector,
          evidence: args.evidence ?? [],
          remediation: args.remediation,
          references: args.references ?? [],
          target_id: args.target_id,
        })
        const finding = store.addFinding(input)
        return JSON.stringify({
          finding: {
            id: finding.id,
            title: finding.title,
            severity: finding.severity,
            status: finding.status,
            evidence_level: finding.evidence_level,
            verified: finding.status === "verified",
            gate: finding.verify_gate
              ? {
                  passed: finding.verify_gate.passed,
                  provenance: finding.verify_gate.provenance,
                  reasons: finding.verify_gate.reasons,
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
