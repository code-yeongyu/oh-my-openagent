import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { verifyFingerprint } from "../../features/probe-lab/fingerprint-verifier"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeFingerprintMatrixTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Verify multiple fingerprint profiles against a target URL and summarize the best match.",
    args: {
      url: tool.schema.string().url(),
      fingerprint_ids: tool.schema.array(tool.schema.string()).min(1).max(10),
      body: tool.schema.string().optional(),
      method: tool.schema.enum(["GET", "POST"]).default("POST"),
      provider_id: tool.schema.string().optional(),
    },
    async execute(args) {
      const results = []
      for (const id of args.fingerprint_ids) {
        try {
          results.push(await verifyFingerprint({ store: ctx.store, fingerprintId: id, testUrl: args.url }))
        } catch (err) {
          results.push({ fingerprint_id: id, actual_ja3: null, actual_ja4: null, matched_expected: false, detection_score: 1, anomalies: [err instanceof Error ? err.message : String(err)] })
        }
      }
      const best = [...results].sort((a, b) => a.detection_score - b.detection_score)[0]
      return JSON.stringify({
        results,
        summary: {
          blocked_count: results.filter((row) => row.anomalies.length > 0).length,
          success_count: results.filter((row) => row.anomalies.length === 0).length,
          best_fingerprint: best?.fingerprint_id ?? null,
        },
      })
    },
  })
}
