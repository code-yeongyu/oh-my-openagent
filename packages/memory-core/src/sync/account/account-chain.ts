// This device's verified view of the account's sequence. It starts from the pinned trust anchor,
// walks every served row through the client chain, and extends on demand as the engine pulls. A
// row is usable only after the chain verified it. A cryptographic refusal is remembered with its
// reason and nothing after it is verified. A row the device cannot read, or a keyring row whose
// `/entries` and `/keys` answers disagree, is counted (reason only, never content) and holds the
// rows after it as pending: each row links to the one before it, so nothing past an unresolved row
// can be verified, and the next read retries. Epoch keys open only from wraps the verified chain
// minted.

import type { ChainAnchor } from "../crypto/anchor.ts"
import { type AcceptedBatch, appendEntries, type ChainRejection, type ChainState, emptyChain } from "../crypto/chain.ts"
import type { BatchEntry, KeyringEntry, SyncEntry } from "../crypto/entry.ts"
import type { RejectionCounter } from "../crypto/rejection.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import type { ChainRow } from "../recovery/ports.ts"
import { ownMaterial } from "../recovery/keyring-append.ts"
import { committedWrap, expectedHistory } from "../recovery/served-chain.ts"
import type { AccountHttp } from "./http.ts"

export type ChainPosition =
  | { readonly kind: "batch"; readonly batch: AcceptedBatch }
  | { readonly kind: "keyring" }
  | { readonly kind: "vetoed" }
  | { readonly kind: "refused"; readonly reason: ChainRejection }
  | { readonly kind: "pending" }
  | { readonly kind: "unknown" }

export interface AccountChain {
  readonly account: string
  state(): ChainState
  /** Verifies served rows until `seq` is known (or the chain refuses before it). */
  reach(seq: number): Promise<ChainPosition>
  /** The verified link at `seq`, or null when the chain has not verified that position. */
  linkAt(seq: number): string | null
  /** The epoch key this device holds for `epoch`, opened from its own committed wrap. */
  epochKey(epoch: number): Promise<Uint8Array<ArrayBuffer> | null>
  isMember(): boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const isServedRow = (value: unknown): value is ChainRow =>
  isRecord(value) && Number.isSafeInteger(value["seq"]) && (value["kind"] === "batch" || value["kind"] === "keyring")

// The chain entry for one served row, or null when the row is unreadable or is a keyring row whose
// `/entries` digest or keyring link disagrees with the full record `/keys` served.
const toEntry = (row: unknown, keys: ReadonlyMap<number, KeyringEntry>): SyncEntry | null => {
  if (!isServedRow(row)) return null
  if (row.kind === "batch") return { ...row, kind: "batch", keyring_link: null } satisfies BatchEntry
  const full = keys.get(row.seq)
  return full !== undefined && full.digest === row.digest && full.keyring_link === row.keyring_link ? full : null
}

export async function openAccountChain(input: {
  readonly account: string
  readonly anchor: ChainAnchor
  readonly keyring: DeviceKeyring
  readonly http: AccountHttp
  readonly rejections: RejectionCounter
}): Promise<AccountChain> {
  const { account, keyring, http, rejections } = input
  let state = emptyChain(account, input.anchor)
  const positions = new Map<number, ChainPosition>()
  const links = new Map<number, string>()
  let refusedAt: number | null = null
  let heldFrom: number | null = null
  const keys = new Map<number, Uint8Array<ArrayBuffer>>()
  let keysEpoch = -1

  // One served page: every row up to the first one this device cannot use is walked through the
  // chain; that row is counted and holds the rest. Returns how many rows the page carried.
  const readPage = async (): Promise<number> => {
    const after = state.head?.seq ?? 0
    const rows = await http.listEntriesAfter(after)
    if (rows === null) throw new Error("account sync: the entries read did not answer a list")
    if (rows.length === 0) return 0
    const keyring = rows.some((row) => isRecord(row) && row["kind"] === "keyring") ? await http.listKeys() : []
    if (keyring === null) throw new Error("account sync: the keyring read did not answer a list")
    const bySeq = new Map(keyring.filter(isRecord).map((entry) => [entry.seq, entry]))
    const entries: SyncEntry[] = []
    for (const row of rows) {
      const entry = toEntry(row, bySeq)
      if (entry === null) {
        rejections.record(isServedRow(row) ? "keyring_mismatch" : "entry_unreadable")
        heldFrom = after + entries.length + 1
        break
      }
      entries.push(entry)
    }
    if (entries.length > 0) await walk(entries)
    return rows.length
  }

  const walk = async (entries: SyncEntry[]): Promise<void> => {
    const walked = await appendEntries(state, entries, rejections)
    for (const step of walked.steps) {
      if (step.kind === "batch") positions.set(step.batch.seq, { kind: "batch", batch: step.batch })
      else positions.set(step.seq, step.kind === "keyring" ? { kind: "keyring" } : { kind: "vetoed" })
    }
    for (const entry of entries) {
      if (entry.seq <= (walked.state.head?.seq ?? 0)) links.set(entry.seq, entry.link)
    }
    state = walked.state
    if (!walked.ok) {
      positions.set(walked.seq, { kind: "refused", reason: walked.reason })
      refusedAt = walked.seq
    }
  }

  // Pages until `target` is verified, the server has no more rows, or a row stops the walk. The
  // service serves at most one page per read, so a single read can miss rows (and membership).
  const extend = async (target: number): Promise<void> => {
    heldFrom = null
    for (;;) {
      const before = state.head?.seq ?? 0
      const served = await readPage()
      const head = state.head?.seq ?? 0
      if (served === 0 || refusedAt !== null || heldFrom !== null || head >= target || head === before) return
    }
  }

  const reach = async (seq: number): Promise<ChainPosition> => {
    if (refusedAt === null && (state.head?.seq ?? 0) < seq) await extend(seq)
    const known = positions.get(seq)
    if (known !== undefined) return known
    if (refusedAt !== null && seq > refusedAt) return positions.get(refusedAt) ?? { kind: "unknown" }
    if (heldFrom !== null && seq >= heldFrom) return { kind: "pending" }
    return { kind: "unknown" }
  }

  const epochKey = async (epoch: number): Promise<Uint8Array<ArrayBuffer> | null> => {
    const authority = state.authority
    if (authority === null) return null
    if (keysEpoch !== authority.epoch) {
      const wrap = committedWrap(state, authority.epoch, `device:${keyring.principal().id}`)
      const material = wrap === null ? null : await ownMaterial(keyring, account, wrap, expectedHistory(authority, authority.epoch))
      if (material === null) return null
      keys.clear()
      keys.set(material.epoch, new Uint8Array(material.current))
      for (const older of material.history) keys.set(older.epoch, new Uint8Array(older.key))
      keysEpoch = authority.epoch
    }
    return keys.get(epoch) ?? null
  }

  await extend(Number.MAX_SAFE_INTEGER)
  return {
    account,
    state: () => state,
    reach,
    linkAt: (seq) => links.get(seq) ?? null,
    epochKey,
    isMember: () => state.authority?.members.has(keyring.principal().id) === true,
  }
}
