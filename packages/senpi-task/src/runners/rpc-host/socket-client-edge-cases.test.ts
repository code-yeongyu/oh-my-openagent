import { afterEach, expect, spyOn, test } from "bun:test"
import { Socket } from "node:net"

import { type RpcObject, withRpcSocket } from "./socket-client"

// Edge cases of withRpcSocket's redial rule and caller-stall meter (#14444, #14624). Most run on a controlled clock: the
// meter's probe interval is captured and run by hand, so "the caller stalled" (the clock moves with no probe) and "the
// caller was responsive" (the clock moves one probe period at a time) are exact, with no real-timer race.

type Frame = { readonly id?: unknown; readonly type?: unknown }
type Host = (frame: Frame, socket: Socket) => void

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

function controlledTime() {
  let clock = 1_000
  const probes = new Map<object, () => void>()
  const now = spyOn(performance, "now").mockImplementation(() => clock)
  const every = spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void) => {
    const handle = { unref: () => handle }
    probes.set(handle, fn)
    return handle
  }) as never)
  const stopEvery = spyOn(globalThis, "clearInterval").mockImplementation(((handle: object) => {
    probes.delete(handle)
  }) as never)
  restores.push(() => {
    now.mockRestore()
    every.mockRestore()
    stopEvery.mockRestore()
  })
  return {
    probes,
    /** The caller cannot run: the clock moves and no probe looks. */
    stall: (ms: number) => {
      clock += ms
    },
    /** A probe callback that was already due runs now: the clock does not move. */
    overdueProbe: () => {
      for (const probe of [...probes.values()]) probe()
    },
    /** The caller is responsive: every probe period the probe looks. */
    responsive: (ms: number) => {
      for (let passed = 0; passed < ms; passed += 50) {
        clock += 50
        for (const probe of [...probes.values()]) probe()
      }
    },
  }
}

/** A fake host connection per dial: `host` sees every JSONL frame the caller writes. */
function dialer(host: Host) {
  const sockets: Socket[] = []
  const writes: Array<string | Buffer> = []
  const connect = () => {
    const socket = new Socket()
    socket.write = ((chunk: string | Buffer) => {
      writes.push(chunk)
      if (typeof chunk === "string")
        for (const line of chunk.split("\n").filter((text) => text.length > 0))
          queueMicrotask(() => host(JSON.parse(line) as Frame, socket))
      return true
    }) as never
    queueMicrotask(() => socket.emit("connect"))
    sockets.push(socket)
    restores.push(() => socket.destroy())
    return socket
  }
  return { connect, sockets, writes }
}

const reply = (socket: Socket, frame: Frame) =>
  socket.emit("data", Buffer.from(`${JSON.stringify({ id: frame.id, type: "response", success: true })}\n`))
const drop = (socket: Socket, code: string) =>
  socket.emit("error", Object.assign(new Error(`dropped ${code}`), { code }))

const read = (request: (command: RpcObject & { type: string }) => Promise<RpcObject>) =>
  request({ type: "get_messages" })

test("#given a non-read command dropped by the host during a caller stall #then it is not redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.stall(500)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "prompt", connect }, (request) =>
    request({ type: "prompt" }),
  )
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a subscription dropped by the host during a caller stall #then it is not redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.stall(500)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket(
    "endpoint",
    {
      timeoutMs: 10_000,
      readCommand: "get_messages",
      connect,
      listen: { frame: () => undefined, closed: () => undefined },
    },
    read,
  )
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test.each(["ECONNRESET", "EPIPE"])(
  "#given a read the host dropped with %s as the caller's stall ends #then it is redialed once and answers",
  async (code) => {
    const time = controlledTime()
    const { connect, sockets } = dialer((frame, socket) => {
      if (sockets.length > 1) return reply(socket, frame)
      time.stall(500)
      drop(socket, code)
    })
    const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
    expect(await call).toMatchObject({ success: true })
    expect(sockets.length).toBe(2)
  },
)

test("#given a read whose connection closed without an error as the caller's stall ends #then it is redialed once", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((frame, socket) => {
    if (sockets.length > 1) return reply(socket, frame)
    time.stall(500)
    socket.emit("close")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall whose end a probe saw first #when the drop is handled right after #then the read is redialed", async () => {
  // Timers run before I/O in an event-loop turn: the probe records the stall, then the drop is seen.
  const time = controlledTime()
  const { connect, sockets } = dialer((frame, socket) => {
    if (sockets.length > 1) return reply(socket, frame)
    time.stall(500)
    time.responsive(50)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall that ended and a responsive caller #when the host resets the connection later #then the read is not redialed (#14624 review M5)", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.stall(500)
    time.responsive(300)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a stall whose end a probe recorded #when the host resets right after the first on-time probe #then the read is not redialed (#14624 review M5)", async () => {
  // The probe that sees the stall arms the marker; the next one, on time, proves the caller runs again.
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.stall(500)
    time.responsive(50)
    time.responsive(50)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a connection the caller stalled on before writing anything #when the host's reset is seen only after probes ran on time #then the read is redialed (#14444)", async () => {
  // The host dropped the silent connection during the stall; under load its reset can reach the caller a probe later.
  const time = controlledTime()
  const answering = dialer((frame, socket) => reply(socket, frame))
  const sockets: Socket[] = []
  const connect = () => {
    if (sockets.length > 0) {
      const socket = answering.connect()
      sockets.push(socket)
      return socket
    }
    const silent = new Socket()
    restores.push(() => silent.destroy())
    sockets.push(silent)
    time.stall(500)
    queueMicrotask(() => {
      time.responsive(100)
      drop(silent, "ECONNRESET")
    })
    return silent
  }
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall the caller recovered from #when a second stall ends with the host's drop #then the read is redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((frame, socket) => {
    if (sockets.length > 1) return reply(socket, frame)
    time.stall(500)
    time.responsive(100)
    time.stall(500)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall the request's own clock read saw #when the host drops right after #then the read is redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((frame, socket) => {
    if (sockets.length > 1) return reply(socket, frame)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, (request) => {
    if (sockets.length === 1) time.stall(500)
    return read(request)
  })
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall the request's own clock read saw #when the overdue probe runs next and the host's reset follows #then the read is redialed (#14624 review M5)", async () => {
  // The overdue probe is measured against the previous probe, not against the request's clock read just before it.
  const time = controlledTime()
  const { connect, sockets } = dialer((frame, socket) => {
    if (sockets.length > 1) return reply(socket, frame)
    time.overdueProbe()
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, (request) => {
    if (sockets.length === 1) time.stall(500)
    return read(request)
  })
  expect(await call).toMatchObject({ success: true })
  expect(sockets.length).toBe(2)
})

test("#given a stall the request's own clock read saw #when the overdue probe and then an on-time probe run before the host's reset #then the read is not redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.overdueProbe()
    time.responsive(50)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, (request) => {
    time.stall(500)
    return read(request)
  })
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a read the host dropped with no caller stall #then it is not redialed", async () => {
  controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => drop(socket, "ECONNRESET"))
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a gap no longer than the probe period plus its tolerance #when the host drops the read #then it is not a stall and is not redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    time.stall(100)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a read that already received response bytes #when the host drops it during a stall #then it is not redialed", async () => {
  const time = controlledTime()
  const { connect, sockets } = dialer((_frame, socket) => {
    socket.emit("data", Buffer.from(`${JSON.stringify({ type: "broadcast" })}\n`))
    time.stall(500)
    drop(socket, "ECONNRESET")
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("dropped ECONNRESET")
  expect(sockets.length).toBe(1)
})

test("#given a read that times out #then it is not redialed", async () => {
  // Real time: the timeout is the behavior under test.
  const { connect, sockets } = dialer(() => undefined)
  const call = withRpcSocket("endpoint", { timeoutMs: 100, readCommand: "get_messages", connect }, read)
  await expect(call).rejects.toThrow("timed out")
  expect(sockets.length).toBe(1)
})

test("#given a step timeout shorter than the call's #when the host never answers #then the step times out on its own budget", async () => {
  // Real time: the timeout is the behavior under test.
  const { connect } = dialer(() => undefined)
  const started = performance.now()
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, (request) =>
    request({ type: "get_messages" }, 100),
  )
  await expect(call).rejects.toThrow("timed out")
  expect(performance.now() - started).toBeLessThan(5_000)
})

test("#given the caller stalls past the request's deadline #when the answer arrives after the stall #then the stall is not charged and the read answers", async () => {
  // Real time: the caller blocks 400 ms on a 300 ms budget; the overdue timeout fires first, finds its deadline moved by
  // the stall, and waits again, so the answer queued behind it settles the read.
  const block = (ms: number) => {
    const until = performance.now() + ms
    while (performance.now() < until) {}
  }
  const { connect } = dialer((frame, socket) => {
    setTimeout(() => {
      block(400)
      setTimeout(() => reply(socket, frame), 0)
    }, 0)
  })
  const call = withRpcSocket("endpoint", { timeoutMs: 300, readCommand: "get_messages", connect }, read)
  expect(await call).toMatchObject({ success: true })
})

test("#given a call that ended #then its stall probe is stopped", async () => {
  const time = controlledTime()
  const { connect } = dialer((frame, socket) => reply(socket, frame))
  await withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, read)
  expect(time.probes.size).toBe(0)
})

test("#given a subscription between requests #then no stall probe runs, and the next request runs one again (#14624 review L2)", async () => {
  const time = controlledTime()
  const { connect } = dialer((frame, socket) => reply(socket, frame))
  const seen: number[] = []
  await withRpcSocket(
    "endpoint",
    { timeoutMs: 10_000, connect, listen: { frame: () => undefined, closed: () => undefined } },
    async (request) => {
      await request({ type: "subscribe" })
      seen.push(time.probes.size)
      const next = request({ type: "get_state" })
      seen.push(time.probes.size)
      await next
      seen.push(time.probes.size)
    },
  )
  expect(seen).toEqual([0, 1, 0])
})

test("#given connect throws #then the call rejects with that error and dials once", async () => {
  let dials = 0
  const call = withRpcSocket(
    "endpoint",
    {
      timeoutMs: 10_000,
      readCommand: "get_messages",
      connect: () => {
        dials += 1
        throw Object.assign(new Error("connect refused"), { code: "ECONNRESET" })
      },
    },
    read,
  )
  await expect(call).rejects.toThrow("connect refused")
  expect(dials).toBe(1)
})

test("#given the operation itself throws #then the call rejects with that error and is not redialed", async () => {
  controlledTime()
  const { connect, sockets } = dialer(() => undefined)
  const call = withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", connect }, async () => {
    throw new Error("operation failed")
  })
  await expect(call).rejects.toThrow("operation failed")
  expect(sockets.length).toBe(1)
})

test("#given a secret #then it is written before the first request", async () => {
  controlledTime()
  const secret = new Uint8Array(32).fill(7)
  const { connect, writes } = dialer((frame, socket) => reply(socket, frame))
  await withRpcSocket("endpoint", { timeoutMs: 10_000, readCommand: "get_messages", secret, connect }, read)
  expect(Buffer.isBuffer(writes[0]) && Buffer.from(secret).equals(writes[0] as Buffer)).toBe(true)
  expect(typeof writes[1] === "string" && JSON.parse(writes[1]).type).toBe("get_messages")
})
