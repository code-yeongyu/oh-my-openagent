import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { verifyFingerprint } from "../../features/probe-lab/fingerprint-verifier"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeFingerprintVerifyTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Verify a fingerprint profile against tls.peet.ws-compatible JSON.",
    args: {
      fingerprint_id: tool.schema.string(),
      test_url: tool.schema.string().url().default("https://tls.peet.ws/api/all"),
    },
    async execute(args) {
      try {
        return JSON.stringify(await verifyFingerprint({
          store: ctx.store,
          fingerprintId: args.fingerprint_id,
          testUrl: args.test_url ?? "https://tls.peet.ws/api/all",
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_fingerprint_verify failed: ${message}`
      }
    },
  })
}
