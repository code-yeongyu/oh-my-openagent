// Recall corpus provider: reads committed memory files from HEAD, excluding only the
// repo-root reserved `system/` tree.
//
// Compile-from-committed invariant: every read goes through repo.show at the
// HEAD revision captured up front; the working tree is never consulted, so
// uncommitted edits and untracked files can never leak into a recall corpus.

import type { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs"

export interface RecallDocument {
  readonly path: string
  readonly description: string
  readonly body: string
}

export interface RecallCorpus {
  readonly revision: string | null
  readonly documents: readonly RecallDocument[]
}

const RESERVED_SYSTEM_TREE = "system/"
const MEMORY_FILE_EXTENSION = ".md"

function isRecallCandidatePath(path: string): boolean {
  if (!path.endsWith(MEMORY_FILE_EXTENSION)) return false
  // The exclusion is the reserved ROOT tree only: `reference/system/deploy.md` is ordinary user
  // memory, so matching the segment anywhere would silently hide recallable files.
  return !path.startsWith(RESERVED_SYSTEM_TREE)
}

export async function loadRecallCorpus(repo: GitMemoryRepo): Promise<RecallCorpus> {
  const revision = await repo.head()
  if (revision === null) return { revision: null, documents: [] }
  return loadCorpusAtRevision(repo, revision)
}

async function loadCorpusAtRevision(
  repo: GitMemoryRepo,
  revision: string,
): Promise<RecallCorpus> {
  const documents: RecallDocument[] = []
  for (const path of await repo.lsTree(revision)) {
    if (!isRecallCandidatePath(path)) continue
    const document = parseRecallDocument(path, await repo.show(revision, path))
    if (document !== undefined) documents.push(document)
  }
  documents.sort((left, right) => left.path.localeCompare(right.path))
  return { revision, documents }
}

function parseRecallDocument(path: string, content: string): RecallDocument | undefined {
  try {
    const parsed = parseMemoryFile(content)
    return { path, description: parsed.frontmatter.description, body: parsed.body }
  } catch {
    // Fail-closed: files without valid frontmatter are silently skipped.
    return undefined
  }
}

interface RecallCorpusCacheEntry {
  readonly revision: string | null
  readonly pending: Promise<RecallCorpus>
}

/** Caches the corpus keyed by HEAD sha; a moved HEAD invalidates the entry. */
export class RecallCorpusCache {
  private entry: RecallCorpusCacheEntry | undefined

  async load(repo: GitMemoryRepo): Promise<RecallCorpus> {
    const revision = await repo.head()
    if (this.entry?.revision === revision) return this.entry.pending

    const pending =
      revision === null
        ? Promise.resolve<RecallCorpus>({ revision: null, documents: [] })
        : loadCorpusAtRevision(repo, revision)
    const entry: RecallCorpusCacheEntry = { revision, pending }
    this.entry = entry
    try {
      return await pending
    } catch (error) {
      if (this.entry === entry) this.entry = undefined
      throw error
    }
  }

  clear(): void {
    this.entry = undefined
  }
}
