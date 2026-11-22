import { createServer } from "node:net"
import { readFileSync } from "node:fs"

// A terminal control endpoint in its own process, as senpi's `session-control-server.ts` serves it: a connection whose
// 32-byte secret has not arrived within the handshake window (`SOCKET_HANDSHAKE_TIMEOUT_MS`, 2 s) is dropped, then
// each JSONL request is answered at once. Its own process keeps it running while the caller's event loop is blocked.
const [socketPath, listenAddress] = process.argv.slice(2)
if (socketPath === undefined || listenAddress === undefined)
  throw new Error("usage: caller-stall-host.fixture.ts <socket> <listen address>")
const secret = readFileSync(`${socketPath}.secret`)
const HANDSHAKE_TIMEOUT_MS = 2_000

const server = createServer((socket) => {
  socket.on("error", () => socket.destroy())
  const handshake = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS)
  let received = Buffer.alloc(0)
  let authenticated = false
  let text = ""
  socket.on("data", (chunk: Buffer) => {
    if (!authenticated) {
      received = Buffer.concat([received, chunk])
      if (received.length < secret.length) return
      clearTimeout(handshake)
      if (!received.subarray(0, secret.length).equals(secret)) return socket.destroy()
      authenticated = true
      chunk = received.subarray(secret.length)
    }
    text += chunk.toString("utf8")
    for (let newline = text.indexOf("\n"); newline >= 0; newline = text.indexOf("\n")) {
      const request = JSON.parse(text.slice(0, newline)) as { id: unknown; type: string; sessionId?: string }
      text = text.slice(newline + 1)
      const data =
        request.type === "get_messages"
          ? { messages: [{ role: "user", content: `transcript of ${request.sessionId}` }] }
          : undefined
      socket.write(
        `${JSON.stringify({ id: request.id, type: "response", command: request.type, success: data !== undefined, ...(data === undefined ? { error: "unsupported" } : { data }) })}\n`,
      )
    }
  })
})
// The endpoint is named by its socket path (its secret sits beside it) and served at the address the test dials.
server.listen(listenAddress, () => process.stdout.write("READY\n"))
process.on("SIGTERM", () => server.close(() => process.exit(0)))
