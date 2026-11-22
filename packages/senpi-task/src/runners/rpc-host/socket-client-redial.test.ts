import { expect, spyOn, test } from "bun:test"
import { Socket } from "node:net"
import { withRpcSocket } from "./socket-client"

const block = (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) {}
}

/** A fake connection that connects, lets the caller's event loop block, then drops with the given error code. */
const droppingSocket = (code: string, idleMs = 0) => {
  const socket = new Socket()
  setTimeout(() => {
    socket.emit("connect")
    block(200)
    socket.emit("error", Object.assign(new Error(`dropped ${code}`), { code }))
  }, idleMs)
  return socket
}

test("#given a read whose connection fails with EACCES after a caller stall #then it is not redialed", async () => {
  const sockets: Socket[] = []
  const call = withRpcSocket(
    "endpoint",
    {
      timeoutMs: 2_000,
      readCommand: "get_messages",
      connect: () => {
        const socket = droppingSocket("EACCES")
        sockets.push(socket)
        return socket
      },
    },
    (request) => request({ type: "get_messages" }),
  )
  await expect(call).rejects.toThrow("dropped EACCES")
  expect(sockets.length).toBe(1)
  for (const socket of sockets) socket.destroy()
})

test("#given a read the host dropped (ECONNRESET) after a caller stall #then it is redialed once", async () => {
  const sockets: Socket[] = []
  const call = withRpcSocket(
    "endpoint",
    {
      timeoutMs: 2_000,
      readCommand: "get_messages",
      connect: () => {
        const socket = droppingSocket("ECONNRESET")
        sockets.push(socket)
        return socket
      },
    },
    (request) => request({ type: "get_messages" }),
  )
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(2)
  for (const socket of sockets) socket.destroy()
})

test("#given a redialed read #then the second attempt gets only what is left of the call's budget", async () => {
  const sockets: Socket[] = []
  const started = performance.now()
  const call = withRpcSocket(
    "endpoint",
    {
      timeoutMs: 400,
      readCommand: "get_messages",
      connect: () => {
        // First attempt: 300 ms of the budget pass unblocked, then a stall and a host drop. Second attempt never answers.
        const socket = sockets.length === 0 ? droppingSocket("ECONNRESET", 300) : new Socket()
        if (sockets.length > 0) {
          // A host that accepts the request and never answers.
          socket.write = () => true
          queueMicrotask(() => socket.emit("connect"))
        }
        sockets.push(socket)
        return socket
      },
    },
    (request) => request({ type: "get_messages" }),
  )
  await expect(call).rejects.toThrow("timed out")
  expect(sockets.length).toBe(2)
  // 300 ms used + 200 ms stall + about 100 ms left. A fresh budget would take 300 + 200 + 400.
  expect(performance.now() - started).toBeLessThan(800)
  for (const socket of sockets) socket.destroy()
})
