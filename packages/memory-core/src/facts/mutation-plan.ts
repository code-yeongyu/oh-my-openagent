import { createHash } from "node:crypto"
import { existsSync, readFile } from "../fs/resilient"
import { join } from "node:path"

import { renderAgreementsTarget } from "./agreements-target"
import type { AgreementEvent } from "../agreements/mutate"
import {
  AGREEMENTS_PATH,
  DEFAULT_AGREEMENTS_POLICY,
  type AgreementExtractionRecord,
  type AgreementsPolicy,
} from "../agreements/types"
import type { GitIndexIdentity, GitMemoryRepo, GitPathState, GitWorktreeFileIdentity } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { stampReceipt } from "../tools/claim-frontmatter"
import {
  factsRoutingPaths,
  planFactsRouting,
  renderPersonTargets,
  type FactsAliasTie,
  type FactsPeopleRouting,
  type FactsRoutingPlan,
} from "./person-routing"
import { factDisplayText } from "./display"
import type { FactsBatch, FactsExtractionRecord } from "./extraction"

export interface FactsRecoveryPath {
  readonly path: string
  readonly pre: GitPathState
  readonly post: {
    readonly index: GitIndexIdentity
    readonly worktree: GitWorktreeFileIdentity
  }
}

export class FactsPlanParentDirtyError extends Error {
  override readonly name = "FactsPlanParentDirtyError"
}

export interface FactsApplyRecovery {
  readonly version: 1
  readonly agreementEventVersion?: 1
  readonly batchId: string
  readonly headBeforeApply: string
  readonly recordsHash: string
  readonly people: FactsPeopleRouting | null
  readonly paths: readonly FactsRecoveryPath[]
}

export async function planFactsMutation(
  repo: GitMemoryRepo,
  batch: FactsBatch,
  people: FactsPeopleRouting | undefined,
  onAliasTie?: (tie: FactsAliasTie) => void,
  agreements: AgreementsPolicy = DEFAULT_AGREEMENTS_POLICY,
  onAgreementEvent?: (event: AgreementEvent) => void,
): Promise<FactsApplyRecovery> {
  const headBeforeApply = await repo.head()
  if (headBeforeApply === null) throw new Error("facts repository has no HEAD")
  const routing = await withLiveLedgers(repo, await planFactsRouting(repo.dir, batch.records, people, onAliasTie))
  const agreementRecords = batch.agreements ?? []
  const ledger =
    agreementRecords.length === 0 ? undefined : await renderAgreementsTarget(repo.dir, agreementRecords, agreements)
  for (const event of ledger?.events ?? []) onAgreementEvent?.(event)
  const paths = [...factsRoutingPaths(routing), ...(ledger?.content === undefined ? [] : [AGREEMENTS_PATH])].sort()
  const pre = await repo.pathState.captureAll(paths)
  if ((await repo.status()).trim().length > 0)
    throw new FactsPlanParentDirtyError("facts repository changed during planning")
  const content = new Map<string, string>()
  for (const [path, records] of routing.notes) {
    content.set(path, await renderFactsNote(repo.dir, path, records))
  }
  if (people?.enabled === true) {
    const rendered = await renderPersonTargets(repo.dir, routing, people)
    for (const [path, value] of rendered) content.set(path, value)
  }
  if (ledger?.content !== undefined) content.set(AGREEMENTS_PATH, ledger.content)
  const planned: FactsRecoveryPath[] = []
  for (const path of paths) {
    const before = pre.get(path)
    const value = content.get(path)
    if (before === undefined || value === undefined) throw new Error(`Incomplete facts mutation plan: ${path}`)
    const worktreeOid = await repo.pathState.hashWorktreeBlob(value, true)
    const indexOid = await repo.pathState.hashIndexBlob(path, value, true)
    const mode = before.worktree.kind === "file" ? before.worktree.mode : 0o644
    planned.push({
      path,
      pre: before,
      post: {
        index: { mode: before.index?.mode ?? "100644", oid: indexOid },
        worktree: { kind: "file", mode, oid: worktreeOid },
      },
    })
  }
  return {
    version: 1,
    ...(agreementRecords.length === 0 ? {} : { agreementEventVersion: 1 as const }),
    batchId: batch.batchId,
    headBeforeApply,
    recordsHash: factsRecordsHash(batch.records, batch.agreements),
    people: people === undefined ? null : { ...people },
    paths: planned,
  }
}

export function factsRecordsHash(
  records: readonly FactsExtractionRecord[],
  agreements: readonly AgreementExtractionRecord[] = [],
): string {
  const hashed = agreements.length === 0 ? records : { records, agreements }
  return createHash("sha256").update(JSON.stringify(hashed)).digest("hex")
}

/**
 * A month ledger path that once held facts and is gone now (dream archived it, or it was deleted) is never written
 * again (#12642): links that pointed at it must not come back to life with unrelated content. The month's facts go to
 * the first `<month>-<n>.md` successor that is live or has never existed, so one month has exactly one live ledger.
 */
async function withLiveLedgers(repo: GitMemoryRepo, plan: FactsRoutingPlan): Promise<FactsRoutingPlan> {
  const notes = new Map<string, readonly FactsExtractionRecord[]>()
  for (const [path, records] of plan.notes) {
    const live = await liveLedgerPath(repo, path)
    notes.set(live, [...(notes.get(live) ?? []), ...records])
  }
  return { ...plan, notes }
}

async function liveLedgerPath(repo: GitMemoryRepo, path: string): Promise<string> {
  const stem = path.slice(0, -".md".length)
  for (let generation = 1; ; generation += 1) {
    const candidate = generation === 1 ? path : `${stem}-${generation}.md`
    if (existsSync(join(repo.dir, candidate))) return candidate
    if ((await repo.log({ paths: [candidate], limit: 1 })).length === 0) return candidate
  }
}

async function renderFactsNote(
  root: string,
  relativePath: string,
  records: readonly FactsExtractionRecord[],
): Promise<string> {
  const existing = await readFile(join(root, relativePath), "utf8").catch(() => undefined)
  const parsed =
    existing === undefined
      ? {
          frontmatter: {
            description: `Explicit facts for ${records[0]?.date.slice(0, 7) ?? relativePath.slice(-10, -3)}`,
          },
          body: "",
        }
      : parseMemoryFile(existing)
  const prefix = parsed.body.length === 0 || parsed.body.endsWith("\n") ? "" : "\n"
  const bullets = records.map((record) => `- [${record.date}] ${factDisplayText(record)}`).join("\n")
  const body = `${parsed.body}${prefix}${bullets}\n`
  // Same header rule as every writer and the commit hook: a legacy user header is dropped, a user record becomes mixed.
  const frontmatter =
    existing === undefined ? parsed.frontmatter : stampReceipt(parsed, parsed.frontmatter, body, undefined)
  return renderMemoryFile(frontmatter, body)
}
