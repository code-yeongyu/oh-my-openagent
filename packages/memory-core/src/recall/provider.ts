// Recall corpus provider: reads committed memory files from HEAD, excluding only the
// repo-root reserved `system/` tree.
//
// Compile-from-committed invariant: every read goes through the committed tree of
// the HEAD revision captured up front; the working tree is never consulted, so
// uncommitted edits and untracked files can never leak into a recall corpus.
//
// Process budget: a load is one `ls-tree` plus at most one `cat-file --batch`, never one git
// process per file. A memory repo with thousands of files moves HEAD on every memory write, and
// reading it one `git show` per file from every live session was a machine-wide git storm.

import { join } from "node:path"

import { readFile, realpathSync, stat } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs"
import { recallDocumentTerms } from "./bm25"
import { onRecallDocumentsEncoded, recallTermAccess } from "./bm25-index"
import type { RecallTermIndex, RecallTermPersistence } from "./bm25-persist"

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
  return (await loadCorpusAtRevision(repo, revision, new Map())).corpus
}

/** A parsed file keyed by the blob it came from; `undefined` records an unparseable blob. */
interface LoadedBlob {
  readonly oid: string
  readonly document: RecallDocument | undefined
}

type LoadedBlobs = ReadonlyMap<string, LoadedBlob>

/**
 * Reads only the blobs `previous` does not already hold for the same path and oid, so a HEAD move
 * costs one `ls-tree` plus one `cat-file --batch` over the changed files. Reused documents keep
 * their object identity; blob ids are content addresses, so a reused document is byte-identical.
 */
async function loadCorpusAtRevision(
  repo: GitMemoryRepo,
  revision: string,
  previous: LoadedBlobs,
): Promise<{ readonly corpus: RecallCorpus; readonly loaded: LoadedBlobs }> {
  const entries = (await repo.lsTreeBlobs(revision)).filter((entry) => isRecallCandidatePath(entry.path))
  const blobs = await repo.readBlobs(
    entries.filter((entry) => previous.get(entry.path)?.oid !== entry.oid).map((entry) => entry.oid),
  )
  const loaded = new Map<string, LoadedBlob>()
  const documents: RecallDocument[] = []
  for (const { path, oid } of entries) {
    const reused = previous.get(path)
    const document = reused?.oid === oid ? reused.document : parseRecallDocument(path, requireBlob(blobs, oid, path))
    loaded.set(path, { oid, document })
    if (document !== undefined) documents.push(document)
  }
  documents.sort((left, right) => left.path.localeCompare(right.path))
  return { corpus: { revision, documents }, loaded }
}

function requireBlob(blobs: ReadonlyMap<string, string>, oid: string, path: string): string {
  const content = blobs.get(oid)
  if (content === undefined) throw new Error(`git cat-file did not return blob ${oid} for ${path}`)
  return content
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
  /**
   * Share one corpus per memory repository with every other shared cache in this process. A
   * multi-session host builds one cache per session, and a private cache per session parsed and
   * indexed the same repository once per live session. The shared state lives while any shared
   * cache that loaded the repository is alive.
   */
  readonly shared?: boolean
  /** Told when the persisted recall terms cannot be read or saved; recall itself is unaffected. */
  readonly onTermStoreError?: (error: unknown) => void
  /**
   * Loads the persisted-terms store (`@oh-my-opencode/memory-core/recall-store`) on the first corpus load, so
   * its codec stays out of a host's startup bundle. Without it every new process tokenizes the corpus.
   */
  readonly termStore?: () => Promise<RecallTermStoreModule>
}

export interface RecallTermStoreModule {
  readonly RecallTermPersistence: typeof RecallTermPersistence
}

/** The live index a persisted store reads and seeds. */
export const recallTermIndex: RecallTermIndex = {
  onEncoded: onRecallDocumentsEncoded,
  access: recallTermAccess,
  terms: recallDocumentTerms,
}

const sharedCaches = new Map<string, WeakRef<RecallCorpusCache>>()
const releaseSharedCache = new FinalizationRegistry<{ readonly dir: string; readonly ref: WeakRef<RecallCorpusCache> }>(
  ({ dir, ref }) => {
    if (sharedCaches.get(dir) === ref) sharedCaches.delete(dir)
  },
)

// One repository reached through a symlink, `/tmp` vs `/private/tmp`, or a trailing slash is still one
// corpus; keying by the spelled path gave each spelling its own copy and silently lost the sharing.
function sharedKey(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

function acquireSharedCache(dir: string, options: RecallCorpusCacheOptions): RecallCorpusCache {
  const live = sharedCaches.get(dir)?.deref()
  if (live !== undefined) return live
  const cache = new RecallCorpusCache({ ...options, shared: false })
  const ref = new WeakRef(cache)
  sharedCaches.set(dir, ref)
  releaseSharedCache.register(cache, { dir, ref })
  return cache
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
 * the sha is re-resolved only when the git ref files backing it changed. A moved HEAD re-reads only
 * the blobs that changed since the last successful load of the same repository.
 */
export class RecallCorpusCache {
  private entry: RecallCorpusCacheEntry | undefined
  private probe: HeadProbe | undefined
  private blobs: { readonly dir: string; readonly loaded: LoadedBlobs } | undefined
  private terms: RecallTermPersistence | undefined
  /** Every repository's persisted terms this cache attached, so `settled()` covers a save started before a switch. */
  private readonly attached = new Set<RecallTermPersistence>()
  private readonly resolveHead: (repo: GitMemoryRepo) => Promise<string | null>
  private readonly options: RecallCorpusCacheOptions
  /** Shared mode only: the process-wide caches this instance keeps alive, one per repository. */
  private readonly held = new Map<string, RecallCorpusCache>()

  constructor(options: RecallCorpusCacheOptions = {}) {
    this.options = options
    this.resolveHead = options.head ?? ((repo) => repo.head())
  }

  async load(repo: GitMemoryRepo): Promise<RecallCorpus> {
    if (this.options.shared === true) return this.sharedFor(repo.dir).load(repo)
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
        : this.loadRevision(repo, revision)
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

  /** Settles once no persisted-terms save started by this cache, or a shared cache it holds, is running. */
  async settled(): Promise<void> {
    await Promise.all([
      ...[...this.attached].map((terms) => terms.settled()),
      ...[...this.held.values()].map((cache) => cache.settled()),
    ])
  }

  clear(): void {
    this.held.clear()
    this.entry = undefined
    this.probe = undefined
    this.blobs = undefined
  }

  private sharedFor(dir: string): RecallCorpusCache {
    const key = sharedKey(dir)
    let cache = this.held.get(key)
    if (cache === undefined) {
      cache = acquireSharedCache(key, this.options)
      this.held.set(key, cache)
    }
    return cache
  }

  private async loadRevision(repo: GitMemoryRepo, revision: string): Promise<RecallCorpus> {
    const previous = this.blobs?.dir === repo.dir ? this.blobs.loaded : new Map<string, LoadedBlob>()
    const { corpus, loaded } = await loadCorpusAtRevision(repo, revision, previous)
    this.blobs = { dir: repo.dir, loaded }
    if (this.terms?.dir !== repo.dir) this.terms = await this.persistenceFor(repo.dir)
    await this.terms?.attach(corpus.documents)
    return corpus
  }

  private async persistenceFor(dir: string): Promise<RecallTermPersistence | undefined> {
    if (this.options.termStore === undefined) return undefined
    const onError = this.options.onTermStoreError ?? (() => undefined)
    try {
      const store = await this.options.termStore()
      const persistence = new store.RecallTermPersistence(dir, onError, recallTermIndex)
      this.attached.add(persistence)
      return persistence
    } catch (error) {
      onError(error)
      return undefined
    }
  }
}
