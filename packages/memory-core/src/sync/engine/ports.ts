// The sync engine's ports (sync-design §5-§8, plan todo 16). The engine owns ordering, the
// journal and the lock discipline; everything that talks to the service, verifies or seals
// bytes, holds item CRDT state or touches git sits behind these interfaces, so the engine is
// tested against deterministic fakes and the real implementations (todo 13 crypto, the #10203
// item device, the HTTP transport) plug in without changing it.

/** One pulled sequence entry: a batch the server ordered, never its plaintext. */
export interface PulledEntry {
  readonly seq: number
  /** A keyring record carries no object: it is verified (todo 13) and advances the cursor. */
  readonly kind: "batch" | "keyring"
  /** The batch id (the push's idempotency key); one batch is applied at most once. */
  /** The batch id when the transport can name it; null when only the sealed header does. */
  readonly batchId: string | null
  /** Hex SHA-256 of the object bytes, checked on download before anything else. */
  readonly digest: string
  readonly objectId: string
  /** The principal that signed the record, for the commit's provenance trailer. */
  readonly author: string
}

/** A compaction snapshot covering every entry up to and including `coversSeq`. */
export interface SnapshotRef {
  readonly coversSeq: number
  /** Its chunk objects, in order. */
  readonly objectIds: readonly string[]
  /** Hex SHA-256 of a single-chunk snapshot when the server states one; the verifier checks the rest. */
  readonly digest: string | null
}

export interface PullPage {
  /** Present when the cursor is older than retained history: load it before `entries`. */
  readonly snapshot: SnapshotRef | null
  readonly entries: readonly PulledEntry[]
  /** The server's head when the page was served. */
  readonly head: number
  /** More entries follow after the last one in this page. */
  readonly more: boolean
}

export type AppendResult =
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly error: "stale_base"; readonly head: number }

export interface AppendRequest {
  readonly uploadId: string
  readonly digest: string
  readonly baseSeq: number
  readonly batchId: string
  readonly epoch: number
  readonly link: string
  readonly recordSig: string
}

export interface StreamHandlers {
  /** `sync.advanced` / `sync.keyring.changed`: a trigger carrying the advertised head, never data. */
  readonly onAdvanced: (head: number) => void
  /** The stream connected (true) or dropped (false); while down the engine polls. */
  readonly onConnected: (connected: boolean) => void
}

export interface Transport {
  /** Entries with `seq > after`, in sequence order, at most `limit` of them. */
  pull(after: number, limit: number): Promise<PullPage>
  /** Object bytes, fetched through the Worker after the account check. */
  download(objectId: string): Promise<Uint8Array>
  /** Reserve exactly `size` bytes with this SHA-256; returns the upload id. */
  reserve(size: number, digest: string): Promise<string>
  upload(uploadId: string, bytes: Uint8Array): Promise<void>
  /**
   * Append the uploaded object at `baseSeq + 1`. A repost of `batchId` answers its original seq,
   * and the server must check that BEFORE the base: a push resumed after a crash reposts with a base
   * that its own landed append has already moved, and answering "stale" there would duplicate it.
   */
  append(request: AppendRequest): Promise<AppendResult>
  /** Subscribe to the account event stream; returns the unsubscribe. */
  subscribe(handlers: StreamHandlers): () => void
}

/** A batch's plaintext: per-item CRDT updates, opaque to the engine. */
export interface BatchPayload {
  readonly items: readonly { readonly key: string; readonly ops: Uint8Array }[]
}

/**
 * Why an entry was refused, as a closed set: the status shows the code, never raw crypto detail,
 * so the real verifier maps each receiver check of sync-design §6 onto one of these.
 */
export type RefusalCode =
  | "content_hash"
  | "signature"
  | "chain_link"
  | "epoch"
  | "account_binding"
  | "object_binding"
  | "replayed_content"
  | "sequence_gap"
  | "malformed"

export type Verdict =
  /**
   * `batchId` is the one the sealed header names; the server's rows carry none, so the verifier
   * is the authority for at-most-once per (seq, batch id).
   */
  | { readonly ok: true; readonly payload: BatchPayload; readonly batchId: string }
  | { readonly ok: false; readonly code: RefusalCode }

/**
 * Receiver checks of sync-design §6 in order (chain link, record signature, epoch, account
 * binding, object binding, content hash), then the plaintext. Nothing reaches the item store
 * without passing here.
 */
export interface Verifier {
  verifyEntry(entry: PulledEntry, bytes: Uint8Array): Promise<Verdict>
  verifySnapshot(snapshot: SnapshotRef, chunks: readonly Uint8Array[]): Promise<Verdict>
}

/** A sealed batch: the object bytes plus the chain fields the append carries (sync-design §6). */
export interface SealedBatch {
  readonly bytes: Uint8Array
  readonly epoch: number
  readonly link: string
  readonly recordSig: string
}

/** The outgoing half of the crypto port: encrypt and sign a batch for upload. */
export interface Sealer {
  seal(batchId: string, baseSeq: number, payload: BatchPayload): Promise<SealedBatch>
}

/** The item model (#10203 device API) as the engine uses it. */
export interface ItemStore {
  /** Loads persisted CRDT state and baselines; the engine calls it once before a cycle. */
  load(): Promise<void>
  /** This device's peer id; a journal created under another peer belongs to another device. */
  peer(): string
  /** Item keys the store knows, live or dead. */
  keys(): readonly string[]
  /** captureOnDevice: the working text against the item's materialised baseline; null = no edit. */
  capture(key: string, workingText: string | null): Promise<Uint8Array | null>
  /** Import a verified remote update (or this device's own captured ops). */
  apply(key: string, ops: Uint8Array): Promise<void>
  /**
   * renderForDisk: the item's merged text, or null for a dead item. `diskText` is the file the
   * render will replace (null when absent), so an unchanged model keeps the file's own style.
   */
  render(key: string, diskText: string | null): string | null
  /** The item doc's version (a stable string of its frontier): a render is keyed by (key, version). */
  version(key: string): Promise<string>
  /** recordMaterialized: the text the engine wrote is the item's new baseline. */
  markMaterialized(key: string, text: string | null): Promise<void>
  /** Import a compaction snapshot's state; local pending state is kept. */
  applySnapshot(payload: BatchPayload): Promise<void>
  /** Make CRDT state and baselines durable (temp file + rename) before the journal advances. */
  persist(): Promise<void>
}

/** The memory writer lock: network work never runs while it is held. */
export interface WriterLock {
  withLock<T>(fn: () => Promise<T>): Promise<T>
}

export interface Clock {
  now(): number
  /** Schedule `fn` after `ms`; returns the cancel. */
  after(ms: number, fn: () => void): () => void
}

/** The memory repository: working tree paths, the sync commit and its trailer. */
export interface SyncRepo {
  /** The working tree root; item key `k` lives at `<root>/<k>`. */
  readonly root: string
  /** The git directory; the journal lives in `<gitDir>/omo-sync/`. */
  readonly gitDir: string
  head(): Promise<string | null>
  /** HEAD's tree id; a cycle whose staged tree equals it has nothing to commit. */
  headTree(): Promise<string>
  /**
   * The tree id a commit of HEAD plus `paths` (as they are in the working tree) would have,
   * computed in a private index: the shared index is left untouched, so an agent commit landing
   * meanwhile never swallows the sync's rendered files.
   */
  stageTree(paths: readonly string[]): Promise<string>
  /** Commit exactly `paths` as `OmO Sync` with `message` (trailers included). */
  commit(paths: readonly string[], message: string): Promise<string>
  /** True when a commit reachable from HEAD carries `Sync-Seq: <range>`. */
  hasSyncCommit(range: string): Promise<boolean>
}
