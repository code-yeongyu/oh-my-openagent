import { describe, expect, test } from "bun:test"
import { callHelper, HelperProtocolError, type HelperLease, type HelperSpawner } from "./client"

const A = "a".repeat(64)

function fake(replyLine: string | null) {
  const events: string[] = []
  const spawn: HelperSpawner = () => {
    const { promise: sent, resolve: markSent } = Promise.withResolvers<true>()
    return {
      pid: 4242,
      send: line => {
        events.push(`send ${line.trim()}`)
        markSent(true)
      },
      reply: sent.then(() => {
        events.push("reply")
        return replyLine
      }),
      close: () => events.push("close"),
    }
  }
  const lease = (restoreError?: Error): HelperLease => ({
    handOver: async pid => {
      events.push(`handOver ${pid}`)
    },
    restore: async () => {
      events.push("restore")
      if (restoreError) throw restoreError
    },
  })
  return { events, spawn, lease }
}

describe("keychain helper client (#11262 design 2 and 3.6 R2)", () => {
  test("#given a mutating call #when it runs #then the lock is handed over before the request and restored before stdin closes", async () => {
    const { events, spawn, lease } = fake('{"ok":true,"created":true}')
    expect(await callHelper("/helper", { verb: "write", account: A, value: "v" }, { spawn, lease: lease() })).toEqual({ ok: true, created: true })
    expect(events).toEqual(["handOver 4242", `send {"v":1,"verb":"write","account":"${A}","value":"v"}`, "reply", "restore", "close"])
  })

  test("#given a read #when it runs #then no lease is needed and none is touched", async () => {
    const { events, spawn } = fake('{"missing":true,"present":{"staging":false,"old":false,"oldSlots":[]}}')
    expect(await callHelper("/helper", { verb: "read", account: A }, { spawn })).toEqual({ missing: true, present: { staging: false, old: false, oldSlots: [] } })
    expect(events).toEqual([`send {"v":1,"verb":"read","account":"${A}"}`, "reply", "close"])
  })

  test("#given a mutating call without the session lock #when it runs #then it is refused before any helper starts", async () => {
    const { events, spawn } = fake('{"ok":true}')
    await expect(callHelper("/helper", { verb: "promote", account: A }, { spawn })).rejects.toBeInstanceOf(HelperProtocolError)
    expect(events).toEqual([])
  })

  test("#given the lock was lost during the call #when restore fails #then the error reaches the caller", async () => {
    const { spawn, lease } = fake('{"ok":true}')
    const lost = new Error("lost")
    await expect(callHelper("/helper", { verb: "retire", account: A }, { spawn, lease: lease(lost) })).rejects.toBe(lost)
  })

  test("#given a helper that exits without a reply #when a mutating call runs #then the lock is restored and the call fails", async () => {
    const { events, spawn, lease } = fake(null)
    await expect(callHelper("/helper", { verb: "stage", account: A, value: "v" }, { spawn, lease: lease() })).rejects.toBeInstanceOf(HelperProtocolError)
    expect(events.filter(event => event === "restore")).toHaveLength(1)
    expect(events.at(-1)).toBe("close")
  })

  test("#given a reply line that is not JSON #when parsed #then it is a HelperProtocolError, never a raw SyntaxError", async () => {
    const { spawn } = fake("helper crashed: segmentation fault")
    await expect(callHelper("/helper", { verb: "read", account: A }, { spawn })).rejects.toBeInstanceOf(HelperProtocolError)
  })

  test("#given an unexpected reply shape #when parsed #then it is refused, never trusted", async () => {
    const { spawn } = fake('{"owned":true,"value":"v","extra":1}')
    await expect(callHelper("/helper", { verb: "read", account: A }, { spawn })).rejects.toBeInstanceOf(HelperProtocolError)
  })
})
