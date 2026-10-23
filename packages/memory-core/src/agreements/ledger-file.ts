import { join } from "node:path"

import { readFile } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { stampReceipt } from "../tools/claim-frontmatter"
import { parseAgreementsLedger, serializeAgreementsLedger } from "./format"
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
