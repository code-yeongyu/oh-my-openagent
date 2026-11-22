import type { Server, Socket } from "node:net"
import { createServer } from "node:http"

export type FixtureOptions = {
  /** Bytes the /slow endpoint serves in total. */
  slowBytes: number
  /** Bytes per drip interval on /slow; with `slowIntervalMs` this sets the fixture's speed. */
  slowChunkBytes: number
  slowIntervalMs: number
}

export type FixtureServer = {
  origin: string
  server: Server
  sockets: Set<Socket>
  timers: Set<ReturnType<typeof setInterval>>
}

/**
 * Local download fixtures for the install.ps1 contract tests. No live network is touched.
 * - /stall sends headers plus a 16-byte trickle and then holds the connection open: a transfer
 *   with no progress.
 * - /slow drips `slowChunkBytes` every `slowIntervalMs`: far below broadband speed, but an order
 *   of magnitude above any stall threshold, so it is slow yet progressing.
 * - /r302 and /r/v/1.0.0/asset redirect to /asset, whose Content-Length (123456) is the value a
 *   size lookup must report after following redirects.
 */
export async function startFixtureServer(options: FixtureOptions): Promise<FixtureServer> {
  const { slowBytes, slowChunkBytes, slowIntervalMs } = options
  const sockets = new Set<Socket>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  const server = createServer((req, res) => {
    if (req.url === "/stall") {
      res.writeHead(200, { "Content-Length": String(slowBytes) })
      res.write("x".repeat(16))
      return
    }
    if (req.url === "/slow") {
      res.writeHead(200, { "Content-Length": String(slowBytes) })
      const chunk = "x".repeat(slowChunkBytes)
      let sent = 0
      const timer = setInterval(() => {
        const remaining = slowBytes - sent
        if (remaining <= chunk.length) {
          clearInterval(timer)
          timers.delete(timer)
          res.end(chunk.slice(0, Math.max(0, remaining)))
          return
        }
        res.write(chunk)
        sent += chunk.length
      }, slowIntervalMs)
      timers.add(timer)
      res.on("error", () => {
        clearInterval(timer)
        timers.delete(timer)
      })
      return
    }
    if (req.url === "/r302" || req.url === "/r/v/1.0.0/asset") {
      res.writeHead(302, { Location: "/asset" })
      res.end()
      return
    }
    if (req.url === "/asset") {
      res.writeHead(200, { "Content-Length": "123456" })
      res.end()
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("fixture server has no port")
  return { origin: `http://127.0.0.1:${address.port}`, server, sockets, timers }
}

export function stopFixtureServer(fixture: FixtureServer | undefined): void {
  for (const timer of fixture?.timers ?? []) clearInterval(timer)
  for (const socket of fixture?.sockets ?? []) socket.destroy()
  fixture?.server.closeIdleConnections()
}
