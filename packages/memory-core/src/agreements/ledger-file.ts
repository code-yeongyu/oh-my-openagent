import { join, resolve } from "node:path"

import { readFile } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { stampReceipt } from "../tools/claim-frontmatter"
import { parseAgreementsLedger, serializeAgreementsLedger } from "./format"
import { AGREEMENTS_DESCRIPTION, AGREEMENTS_PATH, type AgreementItem, type FactsKnownAgreement } from "./types"

const committedLedgers = new Map<string, Promise<string | undefined>>()
const LEDGER_CACHE_SIZE = 32

export async function readAgreementsWorktree(repoDir: string): Promise<string | undefined> {
  try {
    return await readFile(join(repoDir, AGREEMENTS_PATH), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

export async function readAgreementsAt(repo: GitMemoryRepo, revision: string): Promise<string | undefined> {
  const read = async () => {
    if (!(await repo.lsTree(revision, AGREEMENTS_PATH)).includes(AGREEMENTS_PATH)) return undefined
    return repo.show(revision, AGREEMENTS_PATH)
  }
  // Symbolic and abbreviated revisions can move; only full object ids are immutable.
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) return read()
  const key = `${resolve(repo.dir)}\0${revision}`
  const cached = committedLedgers.get(key)
  if (cached !== undefined) {
    committedLedgers.delete(key)
    committedLedgers.set(key, cached)
    return cached
  }
  const pending = read()
  committedLedgers.set(key, pending)
  pending.catch(() => {
    if (committedLedgers.get(key) === pending) committedLedgers.delete(key)
  })
  const oldest = committedLedgers.keys().next().value
  if (committedLedgers.size > LEDGER_CACHE_SIZE && oldest !== undefined) committedLedgers.delete(oldest)
  return pending
}

export function agreementItemsOf(content: string | undefined): readonly AgreementItem[] {
  return content === undefined ? [] : parseAgreementsLedger(parseMemoryFile(content).body).items
}

export function renderAgreementsFile(existing: string | undefined, items: readonly AgreementItem[]): string {
  const parsed = existing === undefined ? undefined : parseMemoryFile(existing)
  const unparsed = parsed === undefined ? [] : parseAgreementsLedger(parsed.body).unparsed
  const serialized = serializeAgreementsLedger(items, unparsed)
  const body = serialized.length === 0 ? "" : `${serialized}\n`
  // Neither ledger writer (/agreements, the facts lane) is the memory tool, so the header follows the rule the hooks
  // enforce on every other writer: a user-record header is lowered to "mixed" and a legacy one is dropped.
  const frontmatter = parsed === undefined ? { description: AGREEMENTS_DESCRIPTION } : stampReceipt(parsed, parsed.frontmatter, body, undefined)
  return renderMemoryFile(frontmatter, body)
}

export function knownAgreementsOf(items: readonly AgreementItem[]): readonly FactsKnownAgreement[] {
  return items.map(({ id, scope, by, text, n }) => ({ id, scope, by, text, n }))
}
