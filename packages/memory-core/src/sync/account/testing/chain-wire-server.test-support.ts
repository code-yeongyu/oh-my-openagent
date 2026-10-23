// An in-process HTTP server for one account whose rows are real signed chain entries: the same
// array the recovery world's FakeSyncServer appends keyring records to. It speaks the contract
// 1.17.0 wire for the routes a signed-in device uses (state, entries, keys, batches, uploads,
// objects, keyring appends) and verifies nothing beyond the base check, so every crypto check in
// a test is the client's own.

import { createHash, randomBytes } from "node:crypto"

import type { BatchEntry, KeyringEntry, SyncAuthor, SyncEntry } from "../../crypto/entry.ts"
import { jcsBytes, sha256B64 } from "../../crypto/vendor/sync-format/jcs.ts"
import type { KeyringAppendRequest } from "../../recovery/ports.ts"

type Pending = { id: string; account: string; commitment: string; answer: unknown; reveal: unknown; expires_at: number }

export interface ChainWireServer {
  readonly url: string
  readonly switches: string[]
  /** Rewrites a reveal before it is stored: a relay substituting the joining device's keys. */
  tamperReveal: ((reveal: Record<string, unknown>) => Record<string, unknown>) | null
  pending(): ReadonlyArray<Pending>
  tokenFor(author: SyncAuthor): string
  objectOf(seq: number): Uint8Array | undefined
  replaceObject(seq: number, bytes: Uint8Array): void
  stop(): Promise<void>
}

const refusal = (status: number, code: string): Response => Response.json({ error: { code, message: code } }, { status })

const chainRow = ({ seq, base_seq, kind, account, epoch, author, digest, link, keyring_link, record_sig }: SyncEntry) => ({
  seq, base_seq, kind, account, epoch, author, digest, link, keyring_link, record_sig,
})

export function startChainWireServer(account: string, chain: SyncEntry[]): ChainWireServer {
  const authors = new Map<string, SyncAuthor>()
  const objects = new Map<number, { id: string; batchId: string; bytes: Uint8Array }>()
  const uploads = new Map<string, { size: number; sha256: string; data: Uint8Array | null }>()
  const head = () => chain.at(-1)
  const pairings = new Map<string, Pending>()
  const switches: string[] = []
  const hooks: { tamperReveal: ((reveal: Record<string, unknown>) => Record<string, unknown>) | null } = { tamperReveal: null }
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const author = authors.get((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""))
      if (author === undefined) return refusal(401, "unauthorized")
      const path = url.pathname
      const after = Number(url.searchParams.get("after") ?? "0")
      if (req.method === "GET" && path === "/v1/sync/state") {
        const last = head()
        const keyringLink = [...chain].reverse().find((entry) => entry.kind === "keyring")?.keyring_link ?? ""
        return Response.json({
          head: { seq: last?.seq ?? 0, link: last?.link ?? "", keyring_link: keyringLink },
          current_epoch: last?.epoch ?? 0,
          rotation_pending: false,
          oldest_retained_seq: 1,
          snapshot: null,
          min_client_format: 1,
        })
      }
      if (req.method === "GET" && path === "/v1/sync/entries") return Response.json({ entries: chain.filter((e) => e.seq > after).map(chainRow) })
      if (req.method === "GET" && path === "/v1/sync/keys") return Response.json({ entries: chain.filter((e) => e.kind === "keyring") })
      if (req.method === "GET" && path === "/v1/sync/batches") {
        return Response.json({
          entries: chain.filter((e) => e.seq > after).map((e) => {
            const stored = objects.get(e.seq)
            return { ...chainRow(e), object_id: stored?.id ?? null, bytes: stored?.bytes.byteLength ?? null, batch_id: stored?.batchId ?? null }
          }),
        })
      }
      if (req.method === "GET" && path.startsWith("/v1/sync/objects/")) {
        const id = path.slice("/v1/sync/objects/".length)
        const stored = [...objects.values()].find((o) => o.id === id)
        return stored === undefined ? refusal(404, "not_found") : new Response(stored.bytes)
      }
      if (req.method === "GET" && path === "/v1/me/events") return refusal(404, "not_found")
      if (req.method === "POST" && path === "/v1/sync/uploads") {
        const body = (await req.json()) as { bytes: number; sha256: string }
        const id = randomBytes(16).toString("base64url")
        uploads.set(id, { size: body.bytes, sha256: Buffer.from(body.sha256, "base64url").toString("hex"), data: null })
        return Response.json({ upload_id: id })
      }
      if (req.method === "PUT" && path.startsWith("/v1/sync/uploads/")) {
        const up = uploads.get(path.slice("/v1/sync/uploads/".length))
        const data = new Uint8Array(await req.arrayBuffer())
        if (up === undefined || data.byteLength !== up.size || createHash("sha256").update(data).digest("hex") !== up.sha256) return refusal(400, "invalid_request")
        up.data = data
        return new Response(null, { status: 204 })
      }
      if (req.method === "POST" && path === "/v1/sync/batches") {
        const body = (await req.json()) as { upload_id: string; digest: string; base_seq: number; idempotency_key: string; epoch: number; link: string; record_sig: string }
        const up = uploads.get(body.upload_id)
        if (up === undefined || up.data === null) return refusal(404, "not_found")
        const replay = [...objects.entries()].find(([, o]) => o.batchId === body.idempotency_key)
        if (replay !== undefined) return Response.json({ seq: replay[0] })
        if (body.base_seq !== chain.length) return refusal(409, "stale_base")
        const entry: BatchEntry = {
          seq: chain.length + 1, base_seq: body.base_seq, kind: "batch", account, epoch: body.epoch, author,
          digest: body.digest, link: body.link, keyring_link: null, record_sig: body.record_sig,
        }
        chain.push(entry)
        objects.set(entry.seq, { id: body.upload_id, batchId: body.idempotency_key, bytes: up.data })
        return Response.json({ seq: entry.seq })
      }
      if (req.method === "PUT" && path === "/v1/sync/pending") {
        const body = (await req.json()) as { account: string; commitment: string }
        const row: Pending = { id: randomBytes(9).toString("base64url"), account: body.account, commitment: body.commitment, answer: null, reveal: null, expires_at: Date.now() + 600_000 }
        pairings.set(row.id, row)
        return Response.json(row)
      }
      if (req.method === "GET" && path === "/v1/sync/pending") return Response.json({ pending: [...pairings.values()] })
      const pendingMatch = /^\/v1\/sync\/pending\/([^/]+)(?:\/(answer|reveal))?$/.exec(path)
      if (pendingMatch !== null) {
        const row = pairings.get(pendingMatch[1] ?? "")
        if (row === undefined) return refusal(404, "not_found")
        if (req.method === "GET" && pendingMatch[2] === undefined) return Response.json(row)
        const body = (await req.json()) as Record<string, unknown>
        if (pendingMatch[2] === "answer") row.answer = body
        if (pendingMatch[2] === "reveal") row.reveal = hooks.tamperReveal === null ? body : hooks.tamperReveal(body)
        return Response.json(row)
      }
      if (req.method === "PUT" && (path === "/v1/account/sync" || /^\/v1\/devices\/[^/]+\/sync$/.test(path))) {
        switches.push(`${path} ${JSON.stringify(await req.json())}`)
        return Response.json({ enabled: true })
      }
      if (req.method === "PUT" && path === "/v1/sync/keys") {
        const request = (await req.json()) as KeyringAppendRequest
        if (request.base_seq !== chain.length) return refusal(409, "stale_base")
        const entry: KeyringEntry = {
          seq: chain.length + 1, base_seq: request.base_seq, kind: "keyring", account, epoch: request.record.epoch, author,
          body: request.record, digest: await sha256B64(jcsBytes(request.record)), link: request.link,
          keyring_link: request.keyring_link, record_sig: request.record_sig, wraps: request.wraps,
        }
        chain.push(entry)
        return Response.json(entry)
      }
      return refusal(404, "not_found")
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    switches,
    get tamperReveal() {
      return hooks.tamperReveal
    },
    set tamperReveal(fn) {
      hooks.tamperReveal = fn
    },
    pending: () => [...pairings.values()],
    tokenFor(author) {
      const token = randomBytes(12).toString("base64url")
      authors.set(token, author)
      return token
    },
    objectOf: (seq) => objects.get(seq)?.bytes,
    replaceObject(seq, bytes) {
      const stored = objects.get(seq)
      if (stored !== undefined) objects.set(seq, { ...stored, bytes })
    },
    stop: () => server.stop(true),
  }
}
