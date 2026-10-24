import { join } from "node:path"

import { readFile } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { stampReceipt } from "../tools/claim-frontmatter"
import { parseAgreementsLedger, serializeAgreementsLedger } from "./format"
import { legacyAgreementEvents, serializeAgreementEvents } from "./events"
import { AGREEMENTS_DESCRIPTION, AGREEMENTS_PATH, type AgreementItem, type FactsKnownAgreement } from "./types"

export async function readAgreementsWorktree(repoDir: string): Promise<string | undefined> {
  try {
    return await readFile(join(repoDir, AGREEMENTS_PATH), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

export async function readAgreementsAt(repo: GitMemoryRepo, revision: string): Promise<string | undefined> {
  if (!(await repo.lsTree(revision)).includes(AGREEMENTS_PATH)) return undefined
  return repo.show(revision, AGREEMENTS_PATH)
}

export function agreementItemsOf(content: string | undefined): readonly AgreementItem[] {
  return content === undefined ? [] : parseAgreementsLedger(parseMemoryFile(content).body).items
}

export function renderAgreementsFile(existing: string | undefined, items: readonly AgreementItem[], receipts?: readonly string[]): string {
  const parsed = existing === undefined ? undefined : parseMemoryFile(existing)
  const ledger = parsed === undefined ? undefined : parseAgreementsLedger(parsed.body)
  // The first journal snapshots pre-upgrade dates; later ack/drop must not seed modern dates.
  const prior = ledger?.receipts ?? []
  const kept = receipts ?? (prior.length === 0 ? legacyAgreementEvents(ledger?.items ?? []) : prior)
  const serialized = serializeAgreementsLedger(items, [...(ledger?.unparsed ?? []), ...serializeAgreementEvents(kept)])
  const body = serialized.length === 0 ? "" : `${serialized}\n`
  // Neither ledger writer (/agreements, the facts lane) is the memory tool, so the header follows the rule the hooks
  // enforce on every other writer: a user-record header is lowered to "mixed" and a legacy one is dropped.
  const frontmatter = parsed === undefined ? { description: AGREEMENTS_DESCRIPTION } : stampReceipt(parsed, parsed.frontmatter, body, undefined)
  return renderMemoryFile(frontmatter, body)
}

export function knownAgreementsOf(items: readonly AgreementItem[]): readonly FactsKnownAgreement[] {
  return items.map(({ id, scope, by, text, n }) => ({ id, scope, by, text, n }))
}
