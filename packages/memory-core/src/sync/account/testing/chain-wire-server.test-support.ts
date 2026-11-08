// An in-process HTTP server for one account whose rows are real signed chain entries: the same
// array the recovery world's FakeSyncServer appends keyring records to. It speaks the contract
// 1.17.0 wire for the routes a signed-in device uses (state, entries, keys, batches, uploads,
// objects, keyring appends) and verifies nothing beyond the base check and, as the service does
// before it (#12280), that a batch's record signature is the calling device's own, so every other
// crypto check in a test is the client's own.
// `/entries` serves the contract `SyncPullEntry` row minus `object_id` and `bytes`: `batch_id` on
// batch rows, null on keyring rows. With `entriesBatchId: false` it serves rows without the key, as
// the service does since it dropped that field from `/entries`.
// The service's revoke freeze is the shared FreezeModel: a revoke through
// `DELETE /v1/devices/:id` or `POST /v1/session/sign-out` sets `rotation_pending`, and the rotation
// admission refuses a rotation that keeps a revoked key.

import { createHash, randomBytes } from "node:crypto"

import type { KeyringEntry, SyncAuthor, SyncEntry } from "../../crypto/entry.ts"
import { verifyRecordSig } from "../../crypto/signatures.ts"
import { jcsBytes, sha256B64 } from "../../crypto/vendor/sync-format/jcs.ts"
import type { KeyringAppendRequest } from "../../recovery/ports.ts"
import { servedBatchId, type StoredBatchRow } from "../../recovery/testing/fake-server.test-support.ts"
import { FreezeModel } from "./freeze-model.test-support.ts"

type Pending = { id: string; account: string; commitment: string; answer: unknown; reveal: unknown; expires_at: number }

export interface ChainWireServer {
  readonly url: string
  readonly switches: string[]
  /** Rewrites a reveal before it is stored: a relay substituting the joining device's keys. */
  tamperReveal: ((reveal: Record<string, unknown>) => Record<string, unknown>) | null
  pending(): ReadonlyArray<Pending>
  tokenFor(author: SyncAuthor, serviceDeviceId?: string): string
  enabled(serviceDeviceId: string): boolean
  onWrite: (() => void) | null
  objectOf(seq: number): Uint8Array | undefined
  replaceObject(seq: number, bytes: Uint8Array): void
  readonly freeze: FreezeModel
  /** How many `PUT /v1/sync/keys` requests reached the server. */
  readonly keyAppendsReceived: number
  /** Parks the next `PUT /v1/sync/keys` after it is received and before admission. */
  holdKeysAppend(): { readonly received: Promise<KeyringAppendRequest>; release(): void }
  stop(): Promise<void>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const signingOf = (principal: unknown): string[] => isObject(principal) && typeof principal["signing_public_key"] === "string" ? [principal["signing_public_key"]] : []

/** The service's sync_members: the folded device membership, by signing key. */
const memberKeys = (chain: ReadonlyArray<SyncEntry>): Set<string> => {
  let members = new Set<string>()
  for (const entry of chain) {
    if (entry.kind !== "keyring") continue
    const body: Record<string, unknown> = entry.body
    if (body["kind"] === "genesis") members = new Set(signingOf(isObject(body["bootstrap"]) ? body["bootstrap"]["first_device"] : undefined))
    if (body["kind"] === "approval") for (const key of signingOf(body["principal"])) members.add(key)
    if (body["kind"] === "rotation" && Array.isArray(body["members"])) members = new Set(body["members"].flatMap(signingOf))
    if (body["kind"] === "recovery-join") members = new Set(signingOf(body["principal"]))
  }
  return members
}

const refusal = (status: number, code: string): Response => Response.json({ error: { code, message: code } }, { status })

const chainRow = ({ seq, base_seq, kind, account, epoch, author, digest, link, keyring_link, record_sig }: SyncEntry) => ({
  seq, base_seq, kind, account, epoch, author, digest, link, keyring_link, record_sig,
})

export function startChainWireServer(account: string, chain: SyncEntry[], options: { readonly requireConsent?: boolean; readonly stream?: boolean; readonly entriesBatchId?: boolean } = {}): ChainWireServer {
  const authors = new Map<string, SyncAuthor>()
  const devices = new Map<string, string>()
  const deviceConsent = new Map<string, boolean>()
  let accountConsent = false
  const objects = new Map<number, { id: string; batchId: string; bytes: Uint8Array }>()
  const uploads = new Map<string, { size: number; sha256: string; data: Uint8Array | null }>()
  const head = () => chain.at(-1)
  const pairings = new Map<string, Pending>()
  const switches: string[] = []
  const hooks: { tamperReveal: ((reveal: Record<string, unknown>) => Record<string, unknown>) | null } = { tamperReveal: null }
  let onWrite: (() => void) | null = null
  const freeze = new FreezeModel((key) => memberKeys(chain).has(key))
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const announce = (event: Record<string, unknown>) => {
    const frame = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
    for (const c of streams) c.enqueue(frame)
  }
  freeze.onStateChanged(() => announce({ type: "sync.state.changed" }))
  let keyAppends = 0
  let hold: { readonly received: (request: KeyringAppendRequest) => void; readonly released: Promise<void> } | null = null
  const server = Bun.serve({
    // Bound to the exact address the client dials: on a wildcard bind another process may bind
    // 127.0.0.1 on the same port and answer this fixture's requests.
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const author = authors.get((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""))
      if (author === undefined) return refusal(401, "unauthorized")
      const path = url.pathname
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "")
      const device = devices.get(token) ?? ""
      if (freeze.isRevokedDevice(device)) return freeze.revokedRefusal()
      const routed = freeze.route(req.method, path, device)
      if (routed !== null) return routed
      if (options.requireConsent && (path.includes("/batches") || path.includes("/uploads") || path.includes("/objects") || (path === "/v1/sync/keys" && req.method === "PUT")) &&
          !(accountConsent && deviceConsent.get(device) === true)) return refusal(403, "sync_disabled")
      const after = Number(url.searchParams.get("after") ?? "0")
      if (req.method === "GET" && path === "/v1/sync/state") {
        const last = head()
        const keyringLink = [...chain].reverse().find((entry) => entry.kind === "keyring")?.keyring_link ?? ""
        return Response.json({
          head: { seq: last?.seq ?? 0, link: last?.link ?? "", keyring_link: keyringLink },
          current_epoch: last?.epoch ?? 0,
          rotation_pending: freeze.pending,
          oldest_retained_seq: 1,
          snapshot: null,
          min_client_format: 1,
        })
      }
      if (req.method === "GET" && path === "/v1/sync/entries") {
        const rows = chain.filter((e) => e.seq > after)
        return Response.json({ entries: rows.map((e) => (options.entriesBatchId === false ? chainRow(e) : { ...chainRow(e), batch_id: servedBatchId(e) })) })
      }
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
      if (req.method === "GET" && path === "/v1/me/events") {
        if (options.stream !== true) return refusal(404, "not_found")
        let self: ReadableStreamDefaultController<Uint8Array> | null = null
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            self = c
            streams.add(c)
            c.enqueue(new TextEncoder().encode(": open\n\n"))
          },
          cancel() {
            if (self !== null) streams.delete(self)
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
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
        const fields = { account, base_seq: body.base_seq, digest: body.digest, epoch: body.epoch, link: body.link, keyring_link: null, record_sig: body.record_sig }
        if (author.kind === "device" && !(await verifyRecordSig(author.signing_public_key, fields))) return refusal(400, "invalid_request")
        if (freeze.pending) return freeze.staleRefusal()
        if (body.base_seq !== chain.length) return refusal(409, "stale_base")
        const entry: StoredBatchRow = {
          seq: chain.length + 1, base_seq: body.base_seq, kind: "batch", account, epoch: body.epoch, author,
          digest: body.digest, link: body.link, keyring_link: null, record_sig: body.record_sig, batch_id: body.idempotency_key,
        }
        chain.push(entry)
        objects.set(entry.seq, { id: body.upload_id, batchId: body.idempotency_key, bytes: up.data })
        announce({ type: "sync.advanced", head: { seq: entry.seq, link: entry.link } })
        return Response.json({ seq: entry.seq })
      }
      if (req.method === "PUT" && path === "/v1/sync/pending") {
        const body = (await req.json()) as { account: string; commitment: string }
        const row: Pending = { id: randomBytes(9).toString("base64url"), account: body.account, commitment: body.commitment, answer: null, reveal: null, expires_at: Date.now() + 600_000 }
        pairings.set(row.id, row)
        onWrite?.()
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
        onWrite?.()
        return Response.json(row)
      }
      if (req.method === "PUT" && (path === "/v1/account/sync" || /^\/v1\/devices\/[^/]+\/sync$/.test(path))) {
        const body = await req.json()
        switches.push(`${path} ${JSON.stringify(body)}`)
        const enabled = typeof body === "object" && body !== null && "enabled" in body && body.enabled === true
        if (path === "/v1/account/sync") accountConsent = enabled
        else deviceConsent.set(decodeURIComponent(path.split("/")[3] ?? ""), enabled)
        return Response.json({ enabled: true })
      }
      if (req.method === "PUT" && path === "/v1/sync/keys") {
        const request = (await req.json()) as KeyringAppendRequest
        keyAppends += 1
        const parked = hold
        if (parked !== null) {
          hold = null
          parked.received(request)
          await parked.released
        }
        const digest = await sha256B64(jcsBytes(request.record))
        if (request.base_seq !== chain.length) return refusal(409, "stale_base")
        const kind = request.record["kind"]
        const members = request.record["members"]
        if (kind === "rotation" && Array.isArray(members) && members.flatMap(signingOf).some((key) => freeze.isRevokedKey(key))) {
          return freeze.forbiddenRefusal()
        }
        const entry: KeyringEntry = {
          seq: chain.length + 1, base_seq: request.base_seq, kind: "keyring", account, epoch: request.record.epoch, author,
          body: request.record, digest, link: request.link,
          keyring_link: request.keyring_link, record_sig: request.record_sig, wraps: request.wraps,
        }
        chain.push(entry)
        if (kind === "rotation") freeze.setPending(false)
        if (kind === "recovery-key-removed" || kind === "recovery-join") freeze.setPending(true)
        announce({ type: "sync.keyring.changed", head: { seq: entry.seq, link: entry.link, keyring_link: entry.keyring_link } })
        onWrite?.()
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
    get onWrite() { return onWrite },
    set onWrite(fn) { onWrite = fn },
    enabled: (deviceId) => accountConsent && deviceConsent.get(deviceId) === true,
    tokenFor(author, serviceDeviceId = author.kind === "device" ? author.id : author.credential_id) {
      const token = randomBytes(12).toString("base64url")
      authors.set(token, author)
      devices.set(token, serviceDeviceId)
      freeze.addDevice({
        id: serviceDeviceId, kind: "cli",
        principal: author.kind === "device" ? author.id : null,
        signingKey: author.kind === "device" ? author.signing_public_key : null,
      })
      return token
    },
    freeze,
    get keyAppendsReceived() { return keyAppends },
    holdKeysAppend() {
      const received = Promise.withResolvers<KeyringAppendRequest>()
      const released = Promise.withResolvers<void>()
      hold = { received: received.resolve, released: released.promise }
      return { received: received.promise, release: () => released.resolve() }
    },
    objectOf: (seq) => objects.get(seq)?.bytes,
    replaceObject(seq, bytes) {
      const stored = objects.get(seq)
      if (stored !== undefined) objects.set(seq, { ...stored, bytes })
    },
    stop: () => server.stop(true),
  }
}
