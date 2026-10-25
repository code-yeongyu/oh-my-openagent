import { join } from "node:path"

import { readdir, rm } from "@oh-my-opencode/memory-core/fs"
import { GitMemoryRepo, getPidLiveness, getProcessStartIdentity, type MemoryIdentity } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { activeAppliedBatches, appliedFactsDir, applyFactsWithRetries, type AppliedFactsRequest } from "./facts-batch-apply"
import { describe } from "./facts-run-storage"
import type { FactsRunLedger } from "./facts-runner-types"
import { readRunJson } from "./worker/run-artifacts"

/**
 * Settles `<facts>/applied/<batchId>/` envelopes an interrupted onboarding apply left behind, with
 * the extractor runs' rules: a live owner is left alone, a malformed envelope is invisible, an
 * envelope that never planned wrote nothing and is pruned, and a planned one is finished through
 * `applyFactsWithRetries` (the batch receipt makes it idempotent) and then removed, whatever its
 * terminal outcome. A busy memory-write lock keeps it for the next maintenance pass.
 * Returns true while any envelope is still owned or pending.
 */
export async function reconcileAppliedFactsBatches(options: {
  readonly identity: MemoryIdentity
  readonly withWriterLock: <T>(operation: () => Promise<T>, attempt: number) => Promise<T>
  readonly logger?: ComponentLogger
}): Promise<boolean> {
  const root = appliedFactsDir(options.identity.paths.facts)
  const names = await readdir(root).catch(() => [] as string[])
  let active = false
  for (const name of names.sort()) {
    const runDir = join(root, name)
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json")).catch(() => undefined)
    if (ledger?.batchId !== name) continue
    if (await ownerAlive(runDir, ledger)) {
      active = true
      continue
    }
    if (ledger.applyRecovery === undefined) {
      await rm(runDir, { recursive: true, force: true })
      continue
    }
    const request = await readRunJson<AppliedFactsRequest>(join(runDir, "request.json")).catch(() => undefined)
    if (request === undefined) continue
    let outcome: string
    try {
      const applied = await applyFactsWithRetries({
        runDir,
        ledger,
        repo: new GitMemoryRepo({ dir: options.identity.paths.repo, agentId: options.identity.id }),
        records: [...request.records],
        people: request.people,
        identity: options.identity,
        withWriterLock: options.withWriterLock,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      })
      if (applied === undefined) {
        active = true
        continue
      }
      outcome = applied.outcome
    } catch (error) {
      outcome = `failed: ${describe(error)}`
    }
    if (outcome !== "committed") options.logger?.warn("facts applied batch recovery ended without a commit", { batchId: name, outcome })
    await rm(runDir, { recursive: true, force: true })
  }
  return active
}

async function ownerAlive(runDir: string, ledger: FactsRunLedger): Promise<boolean> {
  if (ledger.pid === undefined) return false
  if (ledger.pid === process.pid) return activeAppliedBatches().has(runDir)
  const liveness = getPidLiveness(ledger.pid)
  if (liveness === "dead") return false
  if (liveness === "unknown" || ledger.processStart === undefined || ledger.processStart === null) return true
  const actual = await getProcessStartIdentity(ledger.pid)
  return actual === null || actual === ledger.processStart
}
