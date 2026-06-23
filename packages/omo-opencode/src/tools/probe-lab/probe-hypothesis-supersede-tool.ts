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

export function __setSupersedeKbClientForTest(client: ReasoningCoreClient | null): void {
  cachedClient = client
}

export function createProbeHypothesisSupersedeTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Mark a hypothesis as superseded by another. Writes a Premise(superseded(hypothesis(id), hypothesis(supersededBy))) to KB Learned.",
    args: {
      hypothesis_id: tool.schema.string(),
      superseded_by: tool.schema.string(),
      reason: tool.schema.string().max(500),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_hypothesis_supersede")
        const target = ctx.store.getHypothesis(args.hypothesis_id)
        if (!target) return `[ERROR] hypothesis not found: ${args.hypothesis_id}`
        const successor = ctx.store.getHypothesis(args.superseded_by)
        if (!successor) return `[ERROR] successor hypothesis not found: ${args.superseded_by}`
        if (args.hypothesis_id === args.superseded_by) {
          return `[ERROR] hypothesis cannot supersede itself`
        }
        const previousStatus = target.status
        ctx.store.setHypothesisSupersededBy(args.hypothesis_id, args.superseded_by)
        ctx.store.insertAuditLog({
          entity_type: "hypothesis",
          entity_id: args.hypothesis_id,
          action: "supersede",
          reason: args.reason,
          changes: { superseded_by: args.superseded_by, previous_status: previousStatus },
        })
        const kbEntryId = await writeKbPremise(args.hypothesis_id, args.superseded_by)
        return JSON.stringify({
          hypothesis_id: args.hypothesis_id,
          superseded_by: args.superseded_by,
          status: "superseded",
          previous_status: previousStatus,
          kb_entry_id: kbEntryId,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_hypothesis_supersede failed: ${message}`
      }
    },
  })
}

async function writeKbPremise(id: string, supersededBy: string): Promise<string | null> {
  try {
    const client = getClient()
    const formula = `superseded(hypothesis(${JSON.stringify(id)}), hypothesis(${JSON.stringify(supersededBy)}))`
    const result = await client.kbAdd({
      layer: "Learned",
      content: { Premise: { formula } },
      tags: ["probe-lab", "supersession", `hypothesis:${id}`, `successor:${supersededBy}`],
    })
    return result.id
  } catch (err) {
    log("[probe-lab] supersede KB write failed (non-blocking)", {
      hypothesis_id: id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
