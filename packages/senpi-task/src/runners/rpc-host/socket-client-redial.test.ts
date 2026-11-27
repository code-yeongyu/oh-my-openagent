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

test("#given a host drop handled after the whole budget ran #then the read is not redialed (#14624 review M1)", async () => {
  // A controlled clock: the first conversation reads 1000, then the reset arrives with the clock at 1500. The meter charges
  // 400 ms of that jump as caller stall (all but its 50 ms period and 50 ms tolerance), so 100 ms of the 100 ms budget ran.
  let clock = 1_000
  const now = spyOn(performance, "now").mockImplementation(() => clock)
  const sockets: Socket[] = []
  try {
    const call = withRpcSocket(
      "endpoint",
      {
        timeoutMs: 100,
        readCommand: "get_messages",
        connect: () => {
          const socket = new Socket()
          socket.write = () => {
            queueMicrotask(() => {
              clock += 500
              socket.emit("error", Object.assign(new Error("dropped ECONNRESET"), { code: "ECONNRESET" }))
            })
            return true
          }
          queueMicrotask(() => socket.emit("connect"))
          sockets.push(socket)
          return socket
        },
      },
      (request) => request({ type: "get_messages" }),
    )
    await expect(call).rejects.toThrow("dropped ECONNRESET")
    expect(sockets.length).toBe(1)
  } finally {
    now.mockRestore()
    for (const socket of sockets) socket.destroy()
  }
})

/**
 * A clock the test moves by hand, for the call budget and the caller-stall meter (#14809). The meter's probe interval is
 * captured instead of scheduled, so the test decides when a probe looks; a conversation's timers are recorded with the
 * delay they were armed with, so the test reads each attempt's budget directly instead of timing the call.
 */
function manualClock() {
  let now = 0
  let probe: (() => void) | undefined
  const armed: number[] = []
  const timers: (() => void)[] = []
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const realSetInterval = globalThis.setInterval
  // Only the conversation's own timers and the meter's probe are taken over; any other timer in the process (the test
  // runner's, another module's) keeps running for real, so it neither lands in `armed` nor stalls.
  const fromSocketClient = () => /socket-client\.ts/.test(new Error().stack ?? "")
  const spies = [
    spyOn(performance, "now").mockImplementation(() => now),
    spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay?: number) => {
      if (!fromSocketClient()) return realSetInterval(callback, delay)
      probe = callback
      return { unref: () => undefined } as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval),
    spyOn(globalThis, "clearInterval").mockImplementation(() => undefined),
    spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
      if (!fromSocketClient()) return realSetTimeout(callback, delay)
      armed.push(delay ?? 0)
      timers.push(callback)
      return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout),
    spyOn(globalThis, "clearTimeout").mockImplementation(((handle?: ReturnType<typeof setTimeout>) => {
      if (!fromSocketClient()) realClearTimeout(handle)
    }) as typeof clearTimeout),
  ]
  return {
    armed,
    /** The caller runs on time: the clock moves in probe-sized steps and a probe looks after each one. */
    run(ms: number) {
      for (let left = ms; left > 0; left -= 50) {
        now += Math.min(50, left)
        probe?.()
      }
    },
    /** Whether socket-client armed its stall probe through the mocked setInterval. */
    probed: () => probe !== undefined,
    /** Fires the timer armed last, as the event loop would once its delay passed. */
    fireLast() {
      timers.at(-1)?.()
    },
    /** The caller's event loop is blocked: the clock moves and no probe looks. */
    stall(ms: number) {
      now += ms
    },
    restore() {
      for (const spy of spies) spy.mockRestore()
    },
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

// #14809: this case used to time the whole call against the wall clock (300 ms run, 200 ms stall, < 800 ms total), which
// left the redial's budget at the mercy of timer overshoot and of where the stall fell between two meter probes; on
// Windows the first attempt used the budget up and the call never redialed. The behaviour under test is the budget:
// the second attempt is armed with what the first one left, never a fresh one. A manual clock makes that exact.
test("#given a redialed read #then the second attempt gets only what is left of the call's budget", async () => {
  // given a 400 ms read whose first connection runs 200 ms, stalls the caller 200 ms (100 ms of it past the meter's
  // tolerance, so excused) and is then reset by the host; the second connection is accepted and never answers
  const clock = manualClock()
  const sockets: Socket[] = []
  try {
    const call = withRpcSocket(
      "endpoint",
      {
        timeoutMs: 400,
        readCommand: "get_messages",
        connect: () => {
          const socket = new Socket()
          socket.write = () => true
          sockets.push(socket)
          return socket
        },
      },
      (request) => request({ type: "get_messages" }),
    )
    // Fail loudly, not by hanging, if socket-client armed its probe or first timer somewhere these mocks do not reach.
    expect({ probe: clock.probed(), armed: clock.armed }).toEqual({ probe: true, armed: [400] })
    // Read the outcome without expect().rejects, which waits on a timer this clock replaces.
    const outcome = call.then(
      () => "resolved",
      (error: Error) => error.message,
    )

    // when
    sockets[0]?.emit("connect")
    await flush()
    clock.run(200)
    clock.stall(200)
    sockets[0]?.emit("error", Object.assign(new Error("dropped ECONNRESET"), { code: "ECONNRESET" }))
    await flush()
    sockets[1]?.emit("connect")
    await flush()
    const secondAttempt = clock.armed.slice(2)
    expect(clock.armed).toEqual([400, 400, 100, 100])
    clock.run(100)
    clock.fireLast()
    const settled = await outcome

    // then: 400 ms budget - 200 ms run - 100 ms of the stall inside the tolerance = 100 ms for the redial (a fresh
    // budget would arm 400)
    expect(settled).toContain("timed out")
    expect(sockets.length).toBe(2)
    expect(clock.armed.slice(0, 2)).toEqual([400, 400])
    expect(secondAttempt).toEqual([100, 100])
  } finally {
    clock.restore()
    for (const socket of sockets) socket.destroy()
  }
})
