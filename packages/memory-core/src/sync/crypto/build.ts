import type { DeviceKeyring } from "../keyring-port.ts"
import type { SyncRecordFields } from "./entry.ts"
import { recordPayload } from "./signatures.ts"
import { asciiBytes, b64urlEncode, concatBytes, type JsonValue, jcsBytes, sha256 } from "./vendor/sync-format/jcs.ts"
import { hkdfSha256 } from "./vendor/sync-format/keys.ts"

export type SyncPayloadRecord = {
  readonly type: 1 | 2 | 3
  readonly spaceId: Uint8Array
  readonly itemKey: string
  readonly body: Uint8Array
}

export type BuildBatchInput = {
  readonly account: string
  readonly kind: "ops" | "snapshot"
  readonly epoch: number
  readonly epochKey: Uint8Array
  readonly keyring: DeviceKeyring
  readonly peers: ReadonlyArray<string>
  readonly batchId: Uint8Array
  readonly salt: Uint8Array
  readonly createdAt: number
  readonly chunk?: { readonly index: number; readonly count: number }
  readonly records: ReadonlyArray<SyncPayloadRecord>
}

const SEGMENT = 65536
const SPACE_ID_BYTES = 16
const MAX_ITEM_KEY_BYTES = 0xffff
const MAX_BODY_BYTES = 0xffffffff

export type BatchInputProblem = "space_id_length" | "item_key_too_long" | "body_too_long"

/** A record the OMOB payload framing cannot carry; thrown before anything is encrypted or signed. */
export class BatchInputError extends Error {
  constructor(readonly problem: BatchInputProblem) {
    super(`buildBatch: ${problem}`)
    this.name = "BatchInputError"
  }
}

const encodePayload = (records: ReadonlyArray<SyncPayloadRecord>): Uint8Array<ArrayBuffer> =>
  concatBytes(
    records.flatMap((record) => {
      const key = new TextEncoder().encode(record.itemKey)
      if (record.spaceId.length !== SPACE_ID_BYTES) throw new BatchInputError("space_id_length")
      if (key.length > MAX_ITEM_KEY_BYTES) throw new BatchInputError("item_key_too_long")
      if (record.body.length > MAX_BODY_BYTES) throw new BatchInputError("body_too_long")
      const head = new Uint8Array(1 + SPACE_ID_BYTES + 2)
      head[0] = record.type
      head.set(record.spaceId, 1)
      new DataView(head.buffer).setUint16(17, key.length, false)
      const length = new Uint8Array(4)
      new DataView(length.buffer).setUint32(0, record.body.length, false)
      return [head, key, length, record.body]
    }),
  )

const segmentNonce = (index: number, last: boolean): Uint8Array<ArrayBuffer> => {
  const nonce = new Uint8Array(12)
  const view = new DataView(nonce.buffer)
  view.setUint16(5, Math.floor(index / 4294967296), false)
  view.setUint32(7, index % 4294967296, false)
  nonce[11] = last ? 1 : 0
  return nonce
}

const deflateRaw = async (payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> => {
  const stream = new CompressionStream("deflate-raw")
  const writer = stream.writable.getWriter()
  const written = writer.write(payload).then(() => writer.close())
  const [compressed] = await Promise.all([new Response(stream.readable).arrayBuffer(), written])
  return new Uint8Array(compressed)
}

const sealStream = async (key: CryptoKey, aad: Uint8Array<ArrayBuffer>, compressed: Uint8Array<ArrayBuffer>) => {
  const count = Math.max(1, Math.ceil(compressed.length / SEGMENT))
  const segments: Uint8Array[] = []
  for (let index = 0; index < count; index += 1) {
    const iv = segmentNonce(index, index === count - 1)
    const slice = compressed.slice(index * SEGMENT, (index + 1) * SEGMENT)
    segments.push(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, slice)))
  }
  return concatBytes(segments)
}

/**
 * Builds one OMOB object (sync-design section 8): canonical header, STREAM payload under
 * HKDF(epoch key, salt, "omo-sync/v1/batch") with AAD = SHA-256(header), and the object
 * signature made by the DeviceKeyring over the object digest - the keyring's private key is
 * never seen here.
 */
export const buildBatch = async (input: BuildBatchInput): Promise<Uint8Array<ArrayBuffer>> => {
  const principal = input.keyring.principal()
  const header: { [key: string]: JsonValue } = {
    account_id: input.account,
    batch_id: b64urlEncode(input.batchId),
    kind: input.kind,
    epoch: input.epoch,
    author: { kind: principal.kind, id: principal.id },
    peers: [...input.peers],
    salt: b64urlEncode(input.salt),
    created_at: input.createdAt,
    ...(input.chunk === undefined ? {} : { chunk: { index: input.chunk.index, count: input.chunk.count } }),
  }
  const headerBytes = jcsBytes(header)
  const batchKey = await hkdfSha256(new Uint8Array(input.epochKey), new Uint8Array(input.salt), asciiBytes("omo-sync/v1/batch"))
  const key = await crypto.subtle.importKey("raw", batchKey, "AES-GCM", false, ["encrypt"])
  const ciphertext = await sealStream(key, await sha256(headerBytes), await deflateRaw(encodePayload(input.records)))
  const preamble = new Uint8Array(10)
  preamble.set([0x4f, 0x4d, 0x4f, 0x42, 1, 0], 0)
  new DataView(preamble.buffer).setUint32(6, headerBytes.length, false)
  const unsigned = concatBytes([preamble, headerBytes, ciphertext])
  const signature = await input.keyring.sign({ purpose: "object-digest", digest: await sha256(unsigned) })
  return concatBytes([unsigned, signature])
}

/** The entry's record_sig, signed by the DeviceKeyring over the section 6 record preimage. */
export const signRecord = async (keyring: DeviceKeyring, fields: SyncRecordFields): Promise<string> =>
  b64urlEncode(await keyring.sign({ purpose: "record", canonicalJson: jcsBytes(recordPayload(fields)) }))
