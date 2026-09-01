import {
  FactsPlanParentDirtyError,
  LockContentionError,
  applyFactsRecovery,
  findFactsBatchReceipt,
  planFactsMutation,
  validateFactsRecovery,
  type FactsApplyRecovery,
  type FactsPeopleRouting,
  type GitMemoryRepo,
  type MemoryIdentity,
  type parseFactsExtractionJsonl,
} from "@oh-my-opencode/memory-core"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { ComponentLogger } from "../../extension/types"
import type { FactsRunLedger } from "./facts-runner-types"
import { updateRunLedger } from "./worker/run-artifacts"

const WRITER_ATTEMPTS = 3

type Applied =
  | { readonly outcome: "committed"; readonly sha: string }
  | { readonly outcome: "parent_dirty"; readonly detail?: string }

export function resolveFactsPeopleRouting(config: OmoConfig, identity: string): FactsPeopleRouting {
  const memory = config.memory
  const override = memory?.agents[identity]?.people
  return {
    enabled: override?.enabled ?? memory?.people.enabled ?? true,
    maxEntries: override?.max_entries ?? memory?.people.max_entries ?? 40,
    maxEntryChars: override?.max_entry_chars ?? memory?.people.max_entry_chars ?? 200,
  }
}

export async function applyFactsWithRetries(options: {
  readonly runDir: string
  readonly ledger: FactsRunLedger
  readonly repo: GitMemoryRepo
  readonly records: ReturnType<typeof parseFactsExtractionJsonl>
  readonly people: FactsPeopleRouting
  readonly identity: MemoryIdentity
  readonly logger?: ComponentLogger
  readonly withWriterLock: <T>(operation: () => Promise<T>, attempt: number) => Promise<T>
  readonly retryDelay?: (attempt: number, delayMs: number) => Promise<void>
  readonly random?: () => number
}): Promise<Applied | undefined> {
  for (let attempt = 1; attempt <= WRITER_ATTEMPTS; attempt += 1) {
    try {
      return await options.withWriterLock(async () => applyClaimed(options), attempt)
    } catch (error) {
      if (!(error instanceof LockContentionError)) throw error
      if (attempt === WRITER_ATTEMPTS) {
        options.logger?.warn("facts extractor memory-write lock exhausted", { runId: options.ledger.runId })
        return undefined
      }
      const jitter = 25 + Math.floor((options.random ?? Math.random)() * 76)
      await (options.retryDelay ?? delay)(attempt, jitter)
    }
  }
  return undefined
}

async function applyClaimed(options: {
  readonly runDir: string
  readonly ledger: FactsRunLedger
  readonly repo: GitMemoryRepo
  readonly records: ReturnType<typeof parseFactsExtractionJsonl>
  readonly people: FactsPeopleRouting
  readonly identity: MemoryIdentity
  readonly logger?: ComponentLogger
}): Promise<Applied> {
  const receipt = await findFactsBatchReceipt(options.repo, options.ledger.batchId)
  if (receipt !== undefined) return { outcome: "committed", sha: receipt.sha }
  const batch = { batchId: options.ledger.batchId, records: options.records }
  let recovery: FactsApplyRecovery
  if (options.ledger.applyRecovery !== undefined) {
    recovery = options.ledger.applyRecovery
    validateFactsRecovery(recovery, batch)
  } else {
    try {
      recovery = await planFactsMutation(options.repo, batch, options.people, (tie) => options.logger?.warn(
        "facts person alias tie resolved by slug order",
        { alias: tie.alias, slugs: tie.slugs.join(","), chosen: tie.chosen },
      ))
    } catch (error) {
      if (error instanceof FactsPlanParentDirtyError) return { outcome: "parent_dirty" }
      throw error
    }
    await updateRunLedger(`${options.runDir}/ledger.json`, {
      headBeforeApply: recovery.headBeforeApply,
      applyRecovery: recovery,
    })
  }
  const result = await applyFactsRecovery(options.repo, recovery, options.records.length, {
    agentId: options.identity.id,
    authorName: "Facts Extractor",
  })
  return result.outcome === "parent_dirty"
    ? result
    : { outcome: "committed", sha: result.sha }
}

function delay(_attempt: number, milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
