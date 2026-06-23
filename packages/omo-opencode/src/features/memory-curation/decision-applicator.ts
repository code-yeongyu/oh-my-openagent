import type { MemoryCoreService } from "../memory-core/service"
import type { CanonicalMemory } from "../memory-core/types"
import type {
  CuratorApplyResult,
  CuratorDecision,
  MergeDecision,
  PromoteDecision,
  SupersedeDecision,
  TagDecision,
} from "./types"

export interface DecisionApplicatorDeps {
  service: MemoryCoreService
  actor?: string
  log?: (message: string, ...args: unknown[]) => void
}

const DEFAULT_ACTOR = "mnemosyne-curator"

export async function applyCuratorDecisions(
  deps: DecisionApplicatorDeps,
  decisions: CuratorDecision[],
): Promise<CuratorApplyResult> {
  const result: CuratorApplyResult = {
    applied: [],
    skipped: [],
    failed: [],
  }

  for (const decision of decisions) {
    try {
      const outcome = await applyDecision(deps, decision)
      if (outcome === "applied") {
        result.applied.push(decision)
      } else {
        result.skipped.push({ decision, reason: outcome })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log?.("[mnemosyne-curator] decision failed", {
        action: decision.action,
        error: message,
      })
      result.failed.push({ decision, error: message })
    }
  }

  return result
}

async function applyDecision(
  deps: DecisionApplicatorDeps,
  decision: CuratorDecision,
): Promise<"applied" | string> {
  switch (decision.action) {
    case "PROMOTE":
      return applyPromote(deps, decision)
    case "DEMOTE":
      return applyDemote(deps, decision)
    case "MERGE":
      return applyMerge(deps, decision)
    case "SUPERSEDE":
      return applySupersede(deps, decision)
    case "TAG":
      return applyTag(deps, decision)
    case "NOOP":
      return "noop"
  }
}

type AuditAction = NonNullable<Parameters<MemoryCoreService["appendAuditLog"]>[0]>["action"]

async function applyPromote(
  deps: DecisionApplicatorDeps,
  decision: PromoteDecision,
): Promise<"applied" | string> {
  const memory = await deps.service.get(decision.memory_id)
  if (!memory) return "memory-not-found"
  await deps.service.update(decision.memory_id, {
    status: "active",
  })
  await deps.service.enqueueOutbox({
    outbox_id: `${decision.memory_id}:curator:promote:${decision.target_tier}`,
    memory_id: decision.memory_id,
    provider_name: decision.target_tier === "L2" ? "mem0" : "corpus-ingestor",
    operation: "create",
    idempotency_key: `${memory.memory_id}:curator:promote:${decision.target_tier}`,
    status: "pending",
  })
  await appendAudit(deps, decision.memory_id, "promoted", decision)
  return "applied"
}

async function applyDemote(
  deps: DecisionApplicatorDeps,
  decision: CuratorDecision & { action: "DEMOTE" },
): Promise<"applied" | string> {
  const memory = await deps.service.get(decision.memory_id)
  if (!memory) return "memory-not-found"
  await deps.service.update(decision.memory_id, {
    status: "pending_review",
  })
  await appendAudit(deps, decision.memory_id, "updated", decision)
  return "applied"
}

async function applyMerge(
  deps: DecisionApplicatorDeps,
  decision: MergeDecision,
): Promise<"applied" | string> {
  const keep = await deps.service.get(decision.keep_memory_id)
  if (!keep) return "keep-memory-not-found"

  if (decision.canonical_summary) {
    await deps.service.update(decision.keep_memory_id, {
      summary: decision.canonical_summary,
    })
  }

  for (const mergeId of decision.merge_memory_ids) {
    if (mergeId === decision.keep_memory_id) continue
    const memory = await deps.service.get(mergeId)
    if (!memory) {
      deps.log?.("[mnemosyne-curator] merge target missing", { mergeId })
      continue
    }
    await deps.service.archive(mergeId)
    await appendAuditRaw(deps, mergeId, "archived", {
      decision: decision as unknown as Record<string, unknown>,
      merged_into: decision.keep_memory_id,
    })
  }

  await appendAudit(deps, decision.keep_memory_id, "updated", decision)
  return "applied"
}

async function applySupersede(
  deps: DecisionApplicatorDeps,
  decision: SupersedeDecision,
): Promise<"applied" | string> {
  const newMemory = await deps.service.get(decision.new_memory_id)
  const oldMemory = await deps.service.get(decision.old_memory_id)
  if (!newMemory) return "new-memory-not-found"
  if (!oldMemory) return "old-memory-not-found"

  await deps.service.archive(decision.old_memory_id)
  await deps.service.update(decision.new_memory_id, {
    source_refs: {
      ...newMemory.source_refs,
      supersedes: decision.old_memory_id,
    },
  })
  await appendAudit(deps, decision.old_memory_id, "superseded", decision)
  await appendAudit(deps, decision.new_memory_id, "updated", decision)
  return "applied"
}

async function applyTag(
  deps: DecisionApplicatorDeps,
  decision: TagDecision,
): Promise<"applied" | string> {
  const memory = await deps.service.get(decision.memory_id)
  if (!memory) return "memory-not-found"

  const patch: Partial<CanonicalMemory> = {}
  if (decision.patch.why_it_matters) patch.why_it_matters = decision.patch.why_it_matters
  if (decision.patch.tags) patch.tags = decision.patch.tags
  if (typeof decision.patch.confidence === "number") {
    patch.confidence = decision.patch.confidence
  }
  if (Object.keys(patch).length === 0) return "empty-patch"

  await deps.service.update(decision.memory_id, patch)
  await appendAudit(deps, decision.memory_id, "updated", decision)
  return "applied"
}

async function appendAudit(
  deps: DecisionApplicatorDeps,
  memoryId: string,
  action: AuditAction,
  decision: CuratorDecision,
): Promise<void> {
  await appendAuditRaw(deps, memoryId, action, {
    decision: decision as unknown as Record<string, unknown>,
    curator_action: decision.action,
  })
}

async function appendAuditRaw(
  deps: DecisionApplicatorDeps,
  memoryId: string,
  action: AuditAction,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.service.appendAuditLog({
      audit_id: `${memoryId}:${action}:${Date.now()}`,
      memory_id: memoryId,
      action,
      actor: deps.actor ?? DEFAULT_ACTOR,
      details,
    })
  } catch (error) {
    deps.log?.("[mnemosyne-curator] audit log failed", {
      memoryId,
      action,
      error,
    })
  }
}
