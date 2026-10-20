// Stand-ins for the todo 13 crypto: sealing is plain JSON that names its batch id and base, and
// the verifier refuses what a real one would - an object naming another batch, another account,
// or any seq the test marks as failing a receiver check.

import type { BatchPayload, PulledEntry, RefusalCode, SealedBatch, Sealer, SnapshotRef, Verdict, Verifier } from "./ports"

interface Sealed {
  readonly account: string
  readonly batchId: string
  readonly baseSeq: number
  readonly items: readonly { readonly key: string; readonly ops: string }[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodePayload(account: string, batchId: string, baseSeq: number, payload: BatchPayload): Uint8Array {
  const sealed: Sealed = {
    account,
    batchId,
    baseSeq,
    items: payload.items.map((i) => ({ key: i.key, ops: Buffer.from(i.ops).toString("base64") })),
  }
  return encoder.encode(JSON.stringify(sealed))
}

export class FakeSealer implements Sealer {
  constructor(private readonly account: string) {}

  async seal(batchId: string, baseSeq: number, payload: BatchPayload): Promise<SealedBatch> {
    return { bytes: encodePayload(this.account, batchId, baseSeq, payload), epoch: 1, link: "A".repeat(43), recordSig: "S".repeat(86) }
  }
}

export class FakeVerifier implements Verifier {
  /** seq -> the receiver check it fails (signature, link, epoch, ...). */
  readonly failing = new Map<number, RefusalCode>()
  readonly refusals: RefusalCode[] = []

  constructor(private readonly account: string) {}

  async verifyEntry(entry: PulledEntry, bytes: Uint8Array): Promise<Verdict> {
    const forced = this.failing.get(entry.seq)
    if (forced !== undefined) return this.refuse(forced)
    if (entry.kind === "keyring") return { ok: true, payload: { items: [] }, batchId: `keyring:${entry.seq}` }
    const sealed = this.open(bytes)
    if (sealed === null) return this.refuse("malformed")
    if (sealed.account !== this.account) return this.refuse("account_binding")
    // The object names its batch and the base it was sealed on; it binds to the entry only when
    // both match (a transport that cannot name the batch id leaves that half to the header).
    if (sealed.baseSeq !== entry.seq - 1) return this.refuse("object_binding")
    if (entry.batchId !== null && sealed.batchId !== entry.batchId) return this.refuse("object_binding")
    return { ok: true, payload: payloadOf(sealed), batchId: sealed.batchId }
  }

  async verifySnapshot(_snapshot: SnapshotRef, chunks: readonly Uint8Array[]): Promise<Verdict> {
    const sealed = chunks.length === 1 && chunks[0] !== undefined ? this.open(chunks[0]) : null
    if (sealed === null) return this.refuse("malformed")
    if (sealed.account !== this.account) return this.refuse("account_binding")
    return { ok: true, payload: payloadOf(sealed), batchId: sealed.batchId }
  }

  private refuse(code: RefusalCode): Verdict {
    this.refusals.push(code)
    return { ok: false, code }
  }

  private open(bytes: Uint8Array): Sealed | null {
    try {
      return JSON.parse(decoder.decode(bytes)) as Sealed
    } catch {
      return null
    }
  }
}

function payloadOf(sealed: Sealed): BatchPayload {
  return { items: sealed.items.map((i) => ({ key: i.key, ops: new Uint8Array(Buffer.from(i.ops, "base64")) })) }
}
