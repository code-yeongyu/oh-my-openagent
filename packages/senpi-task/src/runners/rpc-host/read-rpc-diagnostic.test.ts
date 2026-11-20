import { expect, spyOn, test } from "bun:test"
import { Socket } from "node:net"
import { withRpcSocket } from "./socket-client"

test("only explicitly traced read RPC failures log fixed fields and preserve the exception", async () => {
  const old = process.env.OMO_THREAD_READ_TRACE
  const log = spyOn(console, "error").mockImplementation(() => {})
  const error = Object.assign(new Error("private error detail"), { code: "EPIPE" })
  const run = (readCommand: string) =>
    withRpcSocket(
      "private socket path",
      {
        timeoutMs: 100,
        readCommand,
        connect: () => {
          throw error
        },
      },
      async () => {},
    )
  try {
    delete process.env.OMO_THREAD_READ_TRACE
    await expect(run("list_sessions")).rejects.toBe(error)
    process.env.OMO_THREAD_READ_TRACE = "1"
    await expect(run("private command")).rejects.toBe(error)
    expect(log).not.toHaveBeenCalled()
    await expect(run("list_sessions")).rejects.toBe(error)
    expect(log.mock.calls).toHaveLength(1)
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[thread-read-rpc\] command=list_sessions phase=connect elapsed_ms=\d+ code=EPIPE$/,
    )
  } finally {
    log.mockRestore()
    if (old === undefined) delete process.env.OMO_THREAD_READ_TRACE
    else process.env.OMO_THREAD_READ_TRACE = old
  }
})

test("a partial response identifies a byte-stage deadline without logging response data", async () => {
  const old = process.env.OMO_THREAD_READ_TRACE
  const log = spyOn(console, "error").mockImplementation(() => {})
  const socket = new Socket()
  const write = spyOn(socket, "write").mockImplementation(() => {
    queueMicrotask(() => socket.emit("data", Buffer.from("private response fragment")))
    return true
  })
  try {
    process.env.OMO_THREAD_READ_TRACE = "1"
    const call = withRpcSocket(
      "private endpoint",
      {
        timeoutMs: 50,
        readCommand: "get_messages",
        connect: () => {
          queueMicrotask(() => socket.emit("connect"))
          return socket
        },
      },
      (request) => request({ type: "get_messages", sessionId: "private session" }),
    )
    await expect(call).rejects.toThrow("thread RPC request timed out")
    expect(log.mock.calls).toHaveLength(1)
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[thread-read-rpc\] command=get_messages phase=response-bytes elapsed_ms=\d+ code=DEADLINE$/,
    )
  } finally {
    write.mockRestore()
    log.mockRestore()
    socket.destroy()
    if (old === undefined) delete process.env.OMO_THREAD_READ_TRACE
    else process.env.OMO_THREAD_READ_TRACE = old
  }
})
