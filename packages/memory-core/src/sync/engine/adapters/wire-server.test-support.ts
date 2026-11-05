// An in-process HTTP server speaking the todo 15 sync routes' wire (omo-service #463:
// core/src/sync/routes/{uploads,writes,reads,wire,chain}.ts) and the account event stream: digests
// and links as 43-char base64url, `{ entries }` pages of PAGE rows, the state route carrying the
// head and the latest snapshot, `{ error: { code } }` refusals. It holds bytes, not crypto: the
// header checks and signatures belong to the real server. Also run as a separate process by
// the two-process QA (`bun wire-server.test-support.ts <port-file>`). The service's revoke freeze is
// the shared FreezeModel (every device here counts as a member), reached through the real revoke routes.

import { randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"

import { FreezeModel } from "../../account/testing/freeze-model.test-support.ts"

type Row = { seq: number; digest: string; objectId: string; author: string; batchId: string }

export interface WireServerOptions {
  readonly token: string
  /** device name -> device id, one bearer token each. */
  readonly devices: Readonly<Record<string, string>>
  readonly port?: number
}

export interface WireServer {
  readonly url: string
  pageSize: number
  refuseNext: string | null
  failNext: number | null
  tokenOf(device: string): string
  compactTo(coversSeq: number, chunkIds: readonly string[]): void
  untilStreamsClosed(): Promise<number>
  readonly freeze: FreezeModel
  stop(): Promise<void>
}

const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64url")
const hex = (b64url: string) => Buffer.from(b64url, "base64url").toString("hex")
const STATUS: Readonly<Record<string, number>> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  stale_base: 409,
  quota_exceeded: 403,
  entitlement_required: 403,
  client_update_required: 426,
}
const error = (status: number, code: string) =>
  Response.json({ error: { code, message: code, retryable: status >= 500, requestId: "req" } }, { status })
const refusal = (code: string) => error(STATUS[code] ?? 400, code)

export function startWireServer(options: WireServerOptions): WireServer {
  const rows: Row[] = []
  const objects = new Map<string, Uint8Array>()
  const uploads = new Map<
    string,
    { bytes: number; sha256: string; objectId: string; device: string; data: Uint8Array | null }
  >()
  const tokens = new Map(Object.entries(options.devices).map(([name, id]) => [`${options.token}.${name}`, id]))
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let snapshot: { covers: number; chunks: readonly string[] } | null = null
  let closedWaiters: (() => void)[] = []
  const broadcast = (event: Record<string, unknown>) => {
    const frame = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
    for (const c of streams) c.enqueue(frame)
  }
  const notify = (seq: number) => broadcast({ type: "sync.advanced", head: { seq, link: "A".repeat(43) } })
  const freeze = new FreezeModel(() => true)
  for (const id of Object.values(options.devices)) freeze.addDevice({ id, kind: "cli", principal: id, signingKey: id })
  freeze.onStateChanged(() => broadcast({ type: "sync.state.changed" }))
  const state = {
    pageSize: 500,
    refuseNext: null as string | null,
    failNext: null as number | null,
  }
  const server = Bun.serve({
    // Bound to the exact address the client dials: on a wildcard bind another process may bind
    // 127.0.0.1 on the same port and answer this fixture's requests.
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const device = tokens.get((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""))
      if (device === undefined) return refusal("unauthorized")
      if (freeze.isRevokedDevice(device)) return freeze.revokedRefusal()
      if (state.failNext !== null) {
        const status = state.failNext
        state.failNext = null
        return error(status, "unavailable")
      }
      const path = url.pathname
      const routed = freeze.route(req.method, path, device)
      if (routed !== null) return routed
      if (req.method === "GET" && path === "/v1/me/events") {
        let self: ReadableStreamDefaultController<Uint8Array> | null = null
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            self = c
            streams.add(c)
            c.enqueue(new TextEncoder().encode(": open\n\n"))
          },
          cancel() {
            if (self !== null) streams.delete(self)
            if (streams.size === 0) for (const w of closedWaiters.splice(0)) w()
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
      if (req.method === "GET" && path === "/v1/sync/state") {
        const head = rows.at(-1)?.seq ?? 0
        return Response.json({
          head: { seq: head, link: "A".repeat(43), keyring_link: "A".repeat(43) },
          current_epoch: 1,
          rotation_pending: freeze.pending,
          oldest_retained_seq: (snapshot?.covers ?? 0) + 1,
          snapshot:
            snapshot === null
              ? null
              : {
                  covers_seq: snapshot.covers,
                  author: { kind: "device", id: "x" },
                  chunk_object_ids: snapshot.chunks,
                  link: "A".repeat(43),
                  keyring_head: "A".repeat(43),
                  record_sig: "S",
                },
          min_client_format: 1,
        })
      }
      if (req.method === "GET" && path === "/v1/sync/batches") {
        const after = Number(url.searchParams.get("after") ?? "0")
        const floor = snapshot?.covers ?? 0
        const page = rows.filter((r) => r.seq > after && r.seq > floor).slice(0, state.pageSize)
        return Response.json({
          entries: page.map((r) => ({
            seq: r.seq,
            base_seq: r.seq - 1,
            kind: "batch",
            account: "acct",
            epoch: 1,
            author: { kind: "device", id: r.author },
            digest: b64(r.digest),
            link: "A".repeat(43),
            keyring_link: null,
            record_sig: "S",
            object_id: r.objectId,
            bytes: objects.get(r.objectId)?.byteLength ?? 0,
            batch_id: r.batchId,
          })),
        })
      }
      if (req.method === "GET" && path.startsWith("/v1/sync/objects/")) {
        const bytes = objects.get(path.slice("/v1/sync/objects/".length))
        return bytes === undefined
          ? refusal("not_found")
          : new Response(bytes, { headers: { "content-type": "application/octet-stream" } })
      }
      if (state.refuseNext !== null) {
        const code = state.refuseNext
        state.refuseNext = null
        return refusal(code)
      }
      if (req.method === "POST" && path === "/v1/sync/uploads") {
        const body = (await req.json()) as { kind: string; bytes: number; sha256: string }
        const id = randomBytes(16).toString("base64url")
        uploads.set(id, {
          bytes: body.bytes,
          sha256: hex(body.sha256),
          objectId: randomBytes(16).toString("base64url"),
          device,
          data: null,
        })
        return Response.json({ upload_id: id, object_id: uploads.get(id)?.objectId, expires_at: Date.now() + 900_000 })
      }
      if (req.method === "PUT" && path.startsWith("/v1/sync/uploads/")) {
        const up = uploads.get(path.slice("/v1/sync/uploads/".length))
        if (up === undefined || up.device !== device) return refusal("not_found")
        const data = new Uint8Array(await req.arrayBuffer())
        if (data.byteLength !== up.bytes || new Bun.CryptoHasher("sha256").update(data).digest("hex") !== up.sha256)
          return refusal("invalid_request")
        up.data = data
        return new Response(null, { status: 204 })
      }
      if (req.method === "POST" && path === "/v1/sync/batches") {
        const body = (await req.json()) as {
          upload_id: string
          digest: string
          base_seq: number
          idempotency_key: string
        }
        const up = uploads.get(body.upload_id)
        if (up === undefined || up.data === null || up.device !== device) return refusal("not_found")
        const replay = rows.find((r) => r.batchId === body.idempotency_key)
        if (replay !== undefined) return Response.json({ seq: replay.seq })
        if (freeze.pending) return freeze.staleRefusal()
        if (body.base_seq !== (rows.at(-1)?.seq ?? 0)) return refusal("stale_base")
        objects.set(up.objectId, up.data)
        const seq = body.base_seq + 1
        rows.push({
          seq,
          digest: hex(body.digest),
          objectId: up.objectId,
          author: device,
          batchId: body.idempotency_key,
        })
        notify(seq)
        return Response.json({ seq })
      }
      return refusal("not_found")
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    get pageSize() {
      return state.pageSize
    },
    set pageSize(n) {
      state.pageSize = n
    },
    get refuseNext() {
      return state.refuseNext
    },
    set refuseNext(code) {
      state.refuseNext = code
    },
    get failNext() {
      return state.failNext
    },
    set failNext(status) {
      state.failNext = status
    },
    tokenOf: (name) => `${options.token}.${name}`,
    freeze,
    compactTo(coversSeq, chunkIds) {
      snapshot = { covers: coversSeq, chunks: chunkIds }
    },
    untilStreamsClosed: () =>
      streams.size === 0
        ? Promise.resolve(0)
        : new Promise<number>((resolve) => closedWaiters.push(() => resolve(streams.size))),
    async stop() {
      closedWaiters = []
      await server.stop(true)
    },
  }
}

if (import.meta.main) {
  const portFile = process.argv[2]
  if (portFile === undefined) throw new Error("usage: wire-server.test-support.ts <port-file>")
  const server = startWireServer({ token: "qa", devices: { a: "dev-a", b: "dev-b" } })
  await writeFile(portFile, server.url)
}
