import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"
import { log } from "../../shared"

let cachedClient: ReasoningCoreClient | null = null

function getClient(): ReasoningCoreClient {
  if (cachedClient == null) cachedClient = createReasoningCoreClient()
  return cachedClient
}

export function __setResurrectKbClientForTest(client: ReasoningCoreClient | null): void {
  cachedClient = client
}

export function createProbeHypothesisResurrectTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Resurrect a previously refuted or superseded hypothesis. Sets status='resurrected', records resurrected_from, and writes a Premise(resurrected(hypothesis(id))) to KB Learned.",
    args: {
      hypothesis_id: tool.schema.string(),
      reason: tool.schema.string().max(500),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_hypothesis_resurrect")
        const target = ctx.store.getHypothesis(args.hypothesis_id)
        if (!target) return `[ERROR] hypothesis not found: ${args.hypothesis_id}`
        if (target.status !== "refuted" && target.status !== "superseded") {
          return `[ERROR] hypothesis must be refuted or superseded to resurrect; current status=${target.status}`
        }
        const previousStatus = target.status
        ctx.store.setHypothesisResurrected(args.hypothesis_id, args.hypothesis_id)
        ctx.store.insertAuditLog({
          entity_type: "hypothesis",
          entity_id: args.hypothesis_id,
          action: "resurrect",
          reason: args.reason,
          changes: { previous_status: previousStatus },
        })
        const kbEntryId = await writeKbPremise(args.hypothesis_id)
        return JSON.stringify({
          hypothesis_id: args.hypothesis_id,
          status: "resurrected",
          previous_status: previousStatus,
          resurrected_from: args.hypothesis_id,
          kb_entry_id: kbEntryId,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_hypothesis_resurrect failed: ${message}`
      }
    },
  })
}

async function writeKbPremise(id: string): Promise<string | null> {
  try {
    const client = getClient()
    const formula = `resurrected(hypothesis(${JSON.stringify(id)}))`
    const result = await client.kbAdd({
      layer: "Learned",
      content: { Premise: { formula } },
      tags: ["probe-lab", "resurrection", `hypothesis:${id}`],
    })
    return result.id
  } catch (err) {
    log("[probe-lab] resurrect KB write failed (non-blocking)", {
      hypothesis_id: id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
