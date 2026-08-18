import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { GitIndexIdentity, GitMemoryRepo, GitPathState, GitWorktreeFileIdentity } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import {
  factsRoutingPaths,
  planFactsRouting,
  renderPersonTargets,
  type FactsAliasTie,
  type FactsPeopleRouting,
} from "./person-routing"
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
): Promise<FactsApplyRecovery> {
  const headBeforeApply = await repo.head()
  if (headBeforeApply === null) throw new Error("facts repository has no HEAD")
  const routing = await planFactsRouting(repo.dir, batch.records, people, onAliasTie)
  const paths = factsRoutingPaths(routing)
  const pre = await repo.pathState.captureAll(paths)
  if ((await repo.status()).trim().length > 0) throw new FactsPlanParentDirtyError("facts repository changed during planning")
  const content = new Map<string, string>()
  for (const [path, records] of routing.notes) {
    content.set(path, await renderFactsNote(repo.dir, path, records))
  }
  if (people?.enabled === true) {
    const rendered = await renderPersonTargets(repo.dir, routing, people)
    for (const [path, value] of rendered) content.set(path, value)
  }
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
    batchId: batch.batchId,
    headBeforeApply,
    recordsHash: factsRecordsHash(batch.records),
    people: people === undefined ? null : { ...people },
    paths: planned,
  }
}

export function factsRecordsHash(records: readonly FactsExtractionRecord[]): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex")
}

async function renderFactsNote(
  root: string,
  relativePath: string,
  records: readonly FactsExtractionRecord[],
): Promise<string> {
  const existing = await readFile(join(root, relativePath), "utf8").catch(() => undefined)
  const parsed = existing === undefined
    ? { frontmatter: { description: `Explicit facts for ${relativePath.slice(-10, -3)}` }, body: "" }
    : parseMemoryFile(existing)
  const prefix = parsed.body.length === 0 || parsed.body.endsWith("\n") ? "" : "\n"
  const bullets = records.map((record) => `- [${record.date}] ${record.text}`).join("\n")
  return renderMemoryFile(parsed.frontmatter, `${parsed.body}${prefix}${bullets}\n`)
}
