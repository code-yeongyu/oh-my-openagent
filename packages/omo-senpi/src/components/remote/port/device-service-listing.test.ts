import { describe, expect, test } from "bun:test"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { closingPorts } from "../../thread/remote/testing/closing-ports"

const sessionsPort = closingPorts()

// The port reaches the service a few microtasks after a read starts; a bound turns a read that never lists into a failure.
async function until(reached: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (reached()) return
    await Promise.resolve()
  }
  throw new Error(`never reached: ${what}`)
}

function countingService() {
  let calls = 0
  const pending: (() => void)[] = []
  const service = {
    status: async () => ({ state: "connected" }),
    thisDevice: async () => ({ id: "here", name: "this mac" }),
    devices: async () => [],
    sessions: async () => {
      calls += 1
      await new Promise<void>((resolve) => {
        pending.push(resolve)
      })
      return { rows: [], incomplete: [], revision: calls, query_id: "q", devices: {} }
    },
    endpointCommand: async () => {
      throw new Error("no endpoint")
    },
    closed: new Promise(() => {}),
    close: () => undefined,
  } as unknown as DeviceService
  return {
    service,
    calls: () => calls,
    finish: async () => {
      await until(() => pending.length > 0, "a listing round in flight")
      for (const resolve of pending.splice(0)) resolve()
    },
  }
}

function portOver(s: ReturnType<typeof countingService>, now: () => number) {
  return sessionsPort({ version: "0.0.0-test", connect: async () => ({ conn: s.service, owned: true }), now })
}

async function listed(s: ReturnType<typeof countingService>, read: Promise<unknown>): Promise<void> {
  await s.finish()
  await read
}

describe("device-service adapter: the account listing is shared across the reads of one moment", () => {
  test("#given three reads that overlap #when they run #then one listing round answers all three", async () => {
    const s = countingService()
    const port = portOver(s, () => 0)
    await listed(s, Promise.all([port.sessions(), port.sessions(), port.listing?.()]))
    expect(s.calls()).toBe(1)
  })

  test("#given a round that just ended #when a read comes within the reuse window, then after it #then the first reuses the round and the second lists again", async () => {
    const s = countingService()
    let clock = 0
    const port = portOver(s, () => clock)
    await listed(s, port.sessions())
    clock = 1_000
    await port.sessions()
    expect(s.calls()).toBe(1)
    clock = 2_500
    await listed(s, port.sessions())
    expect(s.calls()).toBe(2)
  })

  test("#given reads for one device #when they overlap #then each goes out as asked, since only the account listing waits on every device", async () => {
    const s = countingService()
    const port = portOver(s, () => 0)
    const reads = Promise.all([port.sessions({ device: "b" }), port.sessions({ device: "b" })])
    await until(() => s.calls() === 2, "two one-device listings in flight")
    await listed(s, reads)
    expect(s.calls()).toBe(2)
  })

  test("#given a listing then a close #when a read comes inside the reuse window #then it lists again instead of reusing the closed connection's round", async () => {
    const s = countingService()
    let clock = 0
    const port = portOver(s, () => clock)
    await listed(s, port.sessions())
    await port.close?.()
    clock = 1_000
    await listed(s, port.sessions())
    expect(s.calls()).toBe(2)
  })

  test("#given a round still running #when a session is closed before it ends #then that round is not kept, and the next read lists again", async () => {
    const s = countingService()
    const port = portOver(s, () => 0)
    const inFlight = port.sessions()
    await until(() => s.calls() === 1, "a listing round in flight")
    await port.sessionCommand("b", "s1", { type: "unload_session" })
    await listed(s, inFlight)
    await listed(s, port.sessions())
    expect(s.calls()).toBe(2)
  })

  test("#given a round that just ended #when a create goes to a device #then the next read lists again, so the new session can be found", async () => {
    const s = countingService()
    const port = portOver(s, () => 0)
    await listed(s, port.sessions())
    await port.endpointCommand("b", { type: "open_session" })
    await listed(s, port.sessions())
    expect(s.calls()).toBe(2)
  })

  test("#given a round that just ended #when a read-only record goes to a session #then the next read reuses the round", async () => {
    const s = countingService()
    const port = portOver(s, () => 0)
    await listed(s, port.sessions())
    await port.sessionCommand("b", "s1", { type: "get_state", sessionId: "s1" })
    await port.sessions()
    expect(s.calls()).toBe(1)
  })

  test("#given a round that fails #when the next read comes within the reuse window #then it lists again instead of reusing the failure", async () => {
    let calls = 0
    const service = {
      sessions: async () => {
        calls += 1
        if (calls === 1) throw new Error("listing failed")
        return { rows: [], incomplete: [], revision: calls, query_id: "q", devices: {} }
      },
      closed: new Promise(() => {}),
      close: () => undefined,
    } as unknown as DeviceService
    const port = sessionsPort({
      version: "0.0.0-test",
      connect: async () => ({ conn: service, owned: true }),
      now: () => 0,
    })
    await expect(port.sessions()).rejects.toThrow("listing failed")
    expect(await port.sessions()).toEqual([])
    expect(calls).toBe(2)
  })
})
