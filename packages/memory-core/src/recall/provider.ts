// Recall corpus provider: reads committed memory files from HEAD, excluding only the
// repo-root reserved `system/` tree.
//
// Compile-from-committed invariant: every read goes through repo.show at the
// HEAD revision captured up front; the working tree is never consulted, so
// uncommitted edits and untracked files can never leak into a recall corpus.

import { join } from "node:path"

import { readFile, stat } from "../fs/resilient"
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

interface HeadProbe {
  readonly dir: string
  readonly signature: string
}

export interface RecallCorpusCacheOptions {
  /** HEAD resolution seam; the default spawns `git rev-parse` through the repo. Injected in tests. */
  readonly head?: (repo: GitMemoryRepo) => Promise<string | null>
}

const REF_NAME = /^refs\/[A-Za-z0-9._\-/]+$/

/**
 * Filesystem fingerprint of what `git rev-parse --verify HEAD` would read: the HEAD file's content
 * plus (mtimeMs,size) of HEAD, of the branch ref HEAD points at, and of packed-refs. Absent ref
 * files are recorded as absent, so packing or unpacking a ref changes the fingerprint too.
 * `undefined` means "cannot be fingerprinted" and always falls open to the git call.
 */
async function headSignature(dir: string): Promise<string | undefined> {
  try {
    const gitDir = join(dir, ".git")
    // A worktree or submodule checkout has a `.git` FILE pointing elsewhere: not fingerprinted here.
    if (!(await stat(gitDir)).isDirectory()) return undefined
    const headPath = join(gitDir, "HEAD")
    const headStat = await stat(headPath)
    const head = (await readFile(headPath, "utf8")).trim()
    const parts = [`head=${head}`, `head-stat=${headStat.mtimeMs}:${headStat.size}`]
    if (head.startsWith("ref:")) {
      const ref = head.slice("ref:".length).trim()
      if (!REF_NAME.test(ref)) return undefined
      parts.push(`ref=${await fileSignature(join(gitDir, ...ref.split("/")))}`)
      parts.push(`packed=${await fileSignature(join(gitDir, "packed-refs"))}`)
    }
    return parts.join("|")
  } catch {
    return undefined
  }
}

async function fileSignature(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return "absent"
  }
}

/**
 * Caches the corpus keyed by HEAD sha; a moved HEAD invalidates the entry. Recall collection runs on
 * every prompt and every tool call, and resolving HEAD spawned `git rev-parse` each time (#8335), so
 * the sha is re-resolved only when the git ref files backing it changed.
 */
export class RecallCorpusCache {
  private entry: RecallCorpusCacheEntry | undefined
  private probe: HeadProbe | undefined
  private readonly resolveHead: (repo: GitMemoryRepo) => Promise<string | null>

  constructor(options: RecallCorpusCacheOptions = {}) {
    this.resolveHead = options.head ?? ((repo) => repo.head())
  }

  async load(repo: GitMemoryRepo): Promise<RecallCorpus> {
    const signature = await headSignature(repo.dir)
    if (
      this.entry !== undefined &&
      signature !== undefined &&
      this.probe?.dir === repo.dir &&
      this.probe.signature === signature
    ) {
      return this.entry.pending
    }

    const revision = await this.resolveHead(repo)
    const probe = signature === undefined ? undefined : { dir: repo.dir, signature }
    if (this.entry?.revision === revision) {
      this.probe = probe
      return this.entry.pending
    }

    const pending =
      revision === null
        ? Promise.resolve<RecallCorpus>({ revision: null, documents: [] })
        : loadCorpusAtRevision(repo, revision)
    const entry: RecallCorpusCacheEntry = { revision, pending }
    this.entry = entry
    this.probe = probe
    try {
      return await pending
    } catch (error) {
      if (this.entry === entry) {
        this.entry = undefined
        this.probe = undefined
      }
      throw error
    }
  }

  clear(): void {
    this.entry = undefined
    this.probe = undefined
  }
}
