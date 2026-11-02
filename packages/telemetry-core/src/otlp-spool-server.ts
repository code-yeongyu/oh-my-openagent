import { gunzipSync } from "node:zlib"

import { attributeMap, decodeLogs, logRecordsOf } from "./otlp-test-support"

export type ServerReply = "ok" | "unavailable" | "hang"

export type CollectorStub = {
  readonly endpoint: string
  /** Event ids of every request answered 200, in arrival order (a duplicate send shows up twice). */
  readonly accepted: string[]
  /** Event ids of every request that reached the server, whatever the reply. */
  readonly received: string[]
  readonly requests: () => number
  readonly nextRequest: () => Promise<void>
  reply: ServerReply
  readonly stop: () => void
}

/** A local OTLP/HTTP logs endpoint that records the event ids (`log.record.uid`) of each request. */
export function startCollectorStub(reply: ServerReply = "ok"): CollectorStub {
  const waiters: (() => void)[] = []
  const hung: (() => void)[] = []
  let count = 0
  const stub: CollectorStub = {
    endpoint: "",
    accepted: [],
    received: [],
    requests: () => count,
    nextRequest: () => new Promise<void>((resolve) => waiters.push(resolve)),
    reply,
    stop: () => {
      for (const release of hung.splice(0)) release()
      server.stop(true)
    },
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const raw = new Uint8Array(await request.arrayBuffer())
      const body = request.headers.get("content-encoding") === "gzip" ? new Uint8Array(gunzipSync(raw)) : raw
      const ids = logRecordsOf(decodeLogs(body)).map((record) => String(attributeMap(record.attributes)["log.record.uid"]))
      count += 1
      stub.received.push(...ids)
      for (const wake of waiters.splice(0)) wake()
      if (stub.reply === "hang") {
        await new Promise<void>((resolve) => hung.push(resolve))
        return new Response(null, { status: 503 })
      }
      if (stub.reply === "unavailable") return new Response(null, { status: 503 })
      stub.accepted.push(...ids)
      return new Response(null, { status: 200 })
    },
  })
  return Object.assign(stub, { endpoint: `http://127.0.0.1:${server.port}` })
}
