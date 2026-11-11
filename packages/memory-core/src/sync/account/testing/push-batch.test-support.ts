import type { SyncSession } from "../../engine/open.ts"

const encoder = new TextEncoder()

/** Seals one single-item batch on `baseSeq` and appends it through the session's own transport. */
export async function pushBatch(
  session: SyncSession,
  batch: { readonly baseSeq: number; readonly key: string; readonly text: string },
): Promise<number> {
  const batchId = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
  const sealed = await session.sealer.seal(batchId, batch.baseSeq, {
    items: [{ key: batch.key, ops: encoder.encode(batch.text) }],
  })
  const digest = new Bun.CryptoHasher("sha256").update(sealed.bytes).digest("hex")
  const uploadId = await session.transport.reserve(sealed.bytes.length, digest)
  await session.transport.upload(uploadId, sealed.bytes)
  const appended = await session.transport.append({
    uploadId,
    digest,
    baseSeq: batch.baseSeq,
    batchId,
    epoch: sealed.epoch,
    link: sealed.link,
    recordSig: sealed.recordSig,
  })
  if (!appended.ok) throw new Error("the append was refused as stale")
  return appended.seq
}
