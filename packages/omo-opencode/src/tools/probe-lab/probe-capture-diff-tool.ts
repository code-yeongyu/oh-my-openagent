import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { diffJsonBodies } from "../../features/probe-lab/structural-diff"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeCaptureDiffTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Compare two captured exchanges, including structural JSON body diffing.",
    args: {
      exchange_id_a: tool.schema.number().int(),
      exchange_id_b: tool.schema.number().int(),
      diff_fields: tool.schema.array(tool.schema.enum(["url", "method", "request_headers", "request_body", "response_status", "response_headers", "response_body", "timing", "fingerprint"])).default(["response_status", "response_body"]),
      structural_diff: tool.schema.boolean().default(true),
    },
    async execute(args) {
      const a = ctx.store.getExchange(args.exchange_id_a)
      const b = ctx.store.getExchange(args.exchange_id_b)
      if (!a || !b) return "[ERROR] exchange not found"
      const fields = args.diff_fields ?? ["response_status", "response_body"]
      const bodyDiff = (args.structural_diff ?? true) && fields.includes("response_body")
        ? diffJsonBodies(toText(a.response_body), toText(b.response_body))
        : emptyDiff()
      const statusChanged = fields.includes("response_status") && a.response_status !== b.response_status
      return JSON.stringify({
        diffs: statusChanged ? [{ path: "response_status", kind: "changed", before: a.response_status, after: b.response_status }, ...bodyDiff.diffs] : bodyDiff.diffs,
        identical_fields: bodyDiff.identical_fields,
        changed_fields: statusChanged ? ["response_status", ...bodyDiff.changed_fields] : bodyDiff.changed_fields,
        structural_analysis: bodyDiff.structural_analysis,
      })
    },
  })
}

function emptyDiff() {
  return { diffs: [], identical_fields: [], changed_fields: [], structural_analysis: { structural_similarity: 1, added_paths: [], removed_paths: [], changed_paths: [] } }
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}
