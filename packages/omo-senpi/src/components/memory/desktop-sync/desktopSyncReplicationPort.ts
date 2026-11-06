import { z } from "zod"
import type { Transport } from "@oh-my-opencode/memory-core/sync-engine"
import { DesktopSyncServiceError, SyncInteger, requireSyncSuccess, syncJson } from "./desktopSyncPortSchema"
import type { SyncServiceCall } from "./desktopSyncAccountPorts"

const stateSchema = z.object({
  head: z.object({ seq: SyncInteger }),
  oldest_retained_seq: SyncInteger,
  snapshot: z.object({ covers_seq: SyncInteger, chunk_object_ids: z.array(z.string()) }).nullable(),
})
const pullReply = z.object({
  state: stateSchema,
  batches: z.object({
    entries: z.array(z.object({
      seq: SyncInteger,
      kind: z.enum(["batch", "keyring"]),
      author: z.object({ kind: z.string(), id: z.string() }),
      digest: z.string(),
      object_id: z.string().nullable(),
      batch_id: z.string().nullable(),
    })),
  }),
  limit: SyncInteger,
})
const sequence = z.object({ seq: SyncInteger })
const reservation = z.object({ upload_id: z.string() })

export function desktopSyncReplicationPort(call: SyncServiceCall, subscribe: Transport["subscribe"]): Transport {
  const json = async (request: Readonly<Record<string, unknown>>) => syncJson(await call(request))
  return {
    async pull(after, limit) {
      const first = pullReply.parse(await json({ op: "pull", after, limit }))
      const state = first.state
      const snapshot = state.snapshot !== null && after < state.oldest_retained_seq - 1
        ? { coversSeq: state.snapshot.covers_seq, objectIds: state.snapshot.chunk_object_ids, digest: null }
        : null
      const from = snapshot === null ? after : Math.max(after, snapshot.coversSeq)
      const page = from === after ? first : pullReply.parse(await json({ op: "pull", after: from, limit }))
      const rows = page.batches.entries.slice(0, limit)
      const last = rows.at(-1)?.seq ?? from
      return {
        snapshot,
        head: Math.max(state.head.seq, last),
        more: last < state.head.seq,
        entries: rows.map(row => {
          const digest = Buffer.from(row.digest, "base64url")
          if (digest.length !== 32 || digest.toString("base64url") !== row.digest) throw new DesktopSyncServiceError("malformed_reply", 200)
          return {
            seq: row.seq,
            kind: row.kind,
            batchId: row.batch_id,
            digest: digest.toString("hex"),
            objectId: row.object_id ?? "",
            author: `${row.author.kind}:${row.author.id}`,
          }
        }),
      }
    },
    async download(objectId) {
      const response = requireSyncSuccess(await call({ op: "download", objectId }))
      if (response.kind !== "bytes") throw new DesktopSyncServiceError("malformed_reply", response.status)
      return response.bytes
    },
    async reserve(size, digest) {
      return reservation.parse(await json({ op: "reserve", size, digest })).upload_id
    },
    async upload(uploadId, ciphertext) {
      await json({ op: "upload", uploadId, ciphertext })
    },
    async append(request) {
      try {
        return { ok: true as const, seq: sequence.parse(await json({ op: "append", request })).seq }
      } catch (error) {
        if (!(error instanceof DesktopSyncServiceError) || error.code !== "stale_base") throw error
        const current = stateSchema.parse(await json({ op: "state" }))
        return { ok: false as const, error: "stale_base" as const, head: current.head.seq }
      }
    },
    subscribe,
  }
}
