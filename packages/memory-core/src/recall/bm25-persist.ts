// Persisted recall terms: a new process takes each note's BM25 terms from a store in the memory repo's
// git dir instead of tokenizing the whole corpus again (1.6-1.8 s at ~6.9k notes). The store is a
// derived cache and never a source of truth:
//   - keyed by the SHA-1 of the exact text a note's terms are made from, under a fingerprint of the
//     tokenizer, so a stored entry is either the note's terms or ignored; ranking is unchanged;
//   - lives in `.git/`, so it is never committed or synced; each machine and clone builds its own;
//   - a missing, unreadable, corrupt or foreign store reads as empty and is rewritten;
//   - written atomically (temp file + rename) after a build that had to tokenize, off the prompt path.

import { createHash, randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"

import { readdir, readFile, rename, rm, stat, writeFile } from "../fs/resilient"
import type { recallDocumentTerms } from "./bm25"
import type { onRecallDocumentsEncoded, RecallTermAccess, StoredDocumentTerms } from "./bm25-index"
import { isRecallTermSaveExcluded, trackRecallTermSave } from "./bm25-persist-gate"

export { withRecallTermSavesExcluded } from "./bm25-persist-gate"
import { decodeRecallTermStore, encodeRecallTermStore } from "./bm25-store"
import { seedRecallDocumentTerms, snapshotRecallDocumentTerms } from "./bm25-terms-transfer"
import type { RecallDocument } from "./provider"

export const RECALL_TERM_STORE_NAME = "omo-recall-bm25-terms.bin"

/**
 * The live BM25 index this persistence reads and seeds. It is passed in rather than imported: the store loads
 * lazily in its own bundle, and a bundled copy of the index would hold terms the ranking never sees.
 */
export interface RecallTermIndex {
  readonly onEncoded: typeof onRecallDocumentsEncoded
  readonly access: RecallTermAccess
  readonly terms: typeof recallDocumentTerms
}
/** Bump with any change to how recall turns text into terms; the probes below may not exercise it. */
const TOKENIZER_VERSION = 1
/** A temp file this old belongs to a save whose process died before its rename. */
const STALE_TEMP_MS = 10 * 60_000

/**
 * Texts whose terms cover every tokenizer rule: CJK runs and bigrams, stand-alone Han characters,
 * NFD Hangul and full-width Latin under NFKC, and English suffix folding. A rule change alters the
 * fingerprint, and a store made by another tokenizer is then ignored.
 */
const FINGERPRINT_PROBES = [
  "Deploying the rollback checklists; libraries, classes, nationalization 2026",
  "\u1112\u1161\u11ab\u1100\u1173\u11af 데이터베이스를 배포했다 ＡＢＣ１２３",
  "東京の記憶管理 データベース 中文检索 ラーメン",
]
let fingerprint: string | undefined

function tokenizerFingerprint(terms: RecallTermIndex["terms"]): string {
  fingerprint ??= sha1(JSON.stringify({ version: TOKENIZER_VERSION, probes: FINGERPRINT_PROBES.map((body) => terms({ path: "", description: "", body })) }))
  return fingerprint
}

const KEYS = new WeakMap<RecallDocument, string>()

function documentKey(document: RecallDocument): string {
  let key = KEYS.get(document)
  if (key === undefined) {
    key = sha1(`${document.description}\n${document.body}`)
    KEYS.set(document, key)
  }
  return key
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

/** The store path, or `undefined` when `.git` is not a directory (a worktree or submodule checkout). */
async function storePath(dir: string): Promise<string | undefined> {
  const gitDir = join(dir, ".git")
  try {
    return (await stat(gitDir)).isDirectory() ? join(gitDir, RECALL_TERM_STORE_NAME) : undefined
  } catch {
    return undefined
  }
}

/** One memory repository's persisted terms; one instance per repository directory. */
export class RecallTermPersistence {
  private primed = false
  private writing: Promise<void> | undefined
  private queued: readonly RecallDocument[] | undefined

  constructor(
    readonly dir: string,
    private readonly onError: (error: unknown) => void,
    private readonly index: RecallTermIndex,
  ) {}

  /**
   * Seeds the documents' terms from the store the first time this repository loads, and saves the
   * terms again after any later build of `documents` that had to tokenize one of them.
   */
  async attach(documents: readonly RecallDocument[]): Promise<void> {
    this.index.onEncoded(documents, () => this.save(documents))
    if (this.primed) return
    this.primed = true
    const path = await storePath(this.dir)
    if (path === undefined) return
    let bytes: Uint8Array
    try {
      bytes = await readFile(path)
    } catch (error) {
      if (!isMissing(error)) this.onError(error)
      return
    }
    try {
      this.seed(documents, bytes)
    } catch (error) {
      this.onError(error)
    }
  }

  private seed(documents: readonly RecallDocument[], bytes: Uint8Array): void {
    const store = decodeRecallTermStore(bytes)
    if (store === undefined || store.fingerprint !== tokenizerFingerprint(this.index.terms)) return
    const entries: Array<readonly [RecallDocument, StoredDocumentTerms]> = []
    for (const document of documents) {
      const stored = store.documents.get(documentKey(document))
      if (stored !== undefined) entries.push([document, stored])
    }
    seedRecallDocumentTerms(this.index.access, store.terms, entries)
  }

  /** Settles once no save is running or queued; saves never reject. */
  async settled(): Promise<void> {
    while (this.writing !== undefined) await this.writing
  }

  private save(documents: readonly RecallDocument[]): void {
    if (isRecallTermSaveExcluded(this.dir)) return
    this.queued = documents
    if (this.writing !== undefined) return
    this.writing = this.drain().finally(() => {
      this.writing = undefined
    })
    trackRecallTermSave(this.dir, this.writing)
  }

  private async drain(): Promise<void> {
    // Yield first: the save is requested from inside a ranking, which must not wait for it.
    await new Promise<void>((resolve) => setImmediate(resolve))
    for (let documents = this.queued; documents !== undefined; documents = this.queued) {
      this.queued = undefined
      if (isRecallTermSaveExcluded(this.dir)) continue
      try {
        await this.write(documents)
      } catch (error) {
        this.onError(error)
      }
    }
  }

  private async write(documents: readonly RecallDocument[]): Promise<void> {
    const snapshot = snapshotRecallDocumentTerms(this.index.access, documents)
    const path = await storePath(this.dir)
    if (snapshot === undefined || path === undefined) return
    const keyed = new Map<string, StoredDocumentTerms>()
    snapshot.documents.forEach((terms, position) => {
      const document = documents[position]
      if (document !== undefined) keyed.set(documentKey(document), terms)
    })
    const bytes = encodeRecallTermStore({ fingerprint: tokenizerFingerprint(this.index.terms), terms: snapshot.terms, documents: keyed })
    if (isRecallTermSaveExcluded(this.dir)) return
    await sweepStaleTemps(path)
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, bytes)
      if (isRecallTermSaveExcluded(this.dir)) {
        await rm(temp, { force: true })
        return
      }
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }
}

/** Removes temp files of saves that died before their rename; a live save's temp file is younger. */
async function sweepStaleTemps(path: string): Promise<void> {
  const dir = dirname(path)
  const prefix = `${basename(path)}.`
  for (const name of await readdir(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue
    const temp = join(dir, name)
    const info = await stat(temp).catch(() => undefined)
    if (info !== undefined && Date.now() - info.mtimeMs > STALE_TEMP_MS) await rm(temp, { force: true })
  }
}
