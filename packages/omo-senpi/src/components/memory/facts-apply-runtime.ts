import { randomUUID } from "node:crypto"

import { MemorySecretError, parseFactsExtractionRecord, sanitizeToSlug, type FactsExtractionRecord, type FactsPeopleRouting } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import type { FactsApplyCall, MemoryFactsApplyResponse } from "./facts-apply-rpc"
import { applyFactsWithRetriesUnderLock, type Applied } from "./facts-batch-apply"

/** Validates the request, then hands the batch to the extractor's apply; unselected records never arrive here. */
export async function applyMemoryFacts(input: {
  readonly context: MemoryIdentityContext
  readonly people: FactsPeopleRouting
  readonly request: unknown
  readonly logger?: ComponentLogger
  readonly newBatchId?: () => string
  readonly apply?: (call: FactsApplyCall) => Promise<Applied | undefined>
}): Promise<MemoryFactsApplyResponse> {
  const raw = isRecord(input.request) ? input.request["records"] : undefined
  if (!Array.isArray(raw)) return { kind: "invalid", reason: "facts apply needs a records list" }
  const clientBatchId = isRecord(input.request) ? input.request["batchId"] : undefined
  if (clientBatchId !== undefined && (typeof clientBatchId !== "string" || !BATCH_ID.test(clientBatchId))) {
    return { kind: "invalid", reason: "batchId must be a UUID v4" }
  }
  const records: FactsExtractionRecord[] = []
  for (const [index, value] of raw.entries()) {
    try {
      records.push(parseFactsExtractionRecord(value, index))
    } catch (error) {
      return { kind: "invalid", reason: `record ${index + 1} rejected: ${describe(error)}` }
    }
  }
  if (records.length === 0) return { outcome: "no_facts", affectedPaths: [] }
  const batchId = clientBatchId ?? (input.newBatchId ?? randomUUID)()
  const context = input.context
  const apply = input.apply ?? ((call: FactsApplyCall) => applyFactsWithRetriesUnderLock({
    identity: { id: context.identity, safeSlug: sanitizeToSlug(context.identity), paths: context.identityPaths },
    ...call,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
  }))
  let applied: Applied | undefined
  try {
    applied = await apply({ batchId, records, people: input.people })
  } catch (error) {
    if (error instanceof MemorySecretError) return { kind: "invalid", reason: error.message }
    throw error
  }
  if (applied === undefined) return { kind: "unavailable", reason: "The memory-write lock stayed busy; try again." }
  if (applied.outcome === "parent_dirty") {
    return { outcome: "parent_dirty", batchId, ...(applied.detail === undefined ? {} : { detail: applied.detail }) }
  }
  return { outcome: "committed", sha: applied.sha, affectedPaths: applied.affectedPaths, batchId }
}

// memory-core's recovery accepts only UUID v4 batch ids; the id also names the envelope directory.
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
