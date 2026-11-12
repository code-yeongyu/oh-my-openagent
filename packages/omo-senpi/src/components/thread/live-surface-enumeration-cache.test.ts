// #12989: on a host where one endpoint enumeration (`host status --all`) takes longer than the cache window, the
// window was stamped when the enumeration started, so its answer arrived already expired: the next view enumerated
// again, and a caller arriving while it ran started a second one. A send paid one enumeration per view.
import { describe, expect, test } from "bun:test"
import {
  createLiveThreadSurface,
  HOST_ENDPOINTS_CACHE_TTL_MS,
  HOST_ENDPOINTS_ENUMERATION_DEADLINE_MS,
  type HostEndpointReport,
} from "./live-surface"

const SLOW_ENUMERATION_MS = HOST_ENDPOINTS_CACHE_TTL_MS + 1_000

function slowHost(firstAnswer: readonly HostEndpointReport[] = []) {
  let clock = 1_000
  let calls = 0
  const pending: Array<() => void> = []
  const surface = createLiveThreadSurface({} as never, {
    env: { SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock" },
    exists: () => false,
    registry: async () => [],
    now: () => clock,
    statusAll: async (): Promise<readonly HostEndpointReport[]> => {
      calls += 1
      // Only the first enumeration is slow; any later one answers at once, so a duplicate is counted, not hung on.
      if (calls === 1) {
        await new Promise<void>((done) => pending.push(done))
        return firstAnswer
      }
      return []
    },
  })
  return {
    surface,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms
    },
    finishEnumeration: () => {
      for (const done of pending.splice(0)) done()
    },
    enumerating: () => pending.length > 0,
  }
}

/** Circuit breaker only: a call that waits on the stuck enumeration fails here instead of hanging the run. */
async function within<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`waited 5s for ${label}, it never settled`)), 5_000)
  })
  try {
    return await Promise.race([work, breaker])
  } finally {
    clearTimeout(timer)
  }
}

async function untilEnumerating(host: ReturnType<typeof slowHost>): Promise<void> {
  for (let turn = 0; turn < 100 && !host.enumerating(); turn++) await Promise.resolve()
  expect(host.enumerating()).toBe(true)
}

describe("live thread surface endpoint cache", () => {
  test("#given an enumeration slower than the cache window #when the next view follows right after it #then that view reuses it", async () => {
    // given
    const host = slowHost()
    const first = host.surface.listView({ offline: true })
    await untilEnumerating(host)
    host.advance(SLOW_ENUMERATION_MS)
    host.finishEnumeration()
    await first

    // when
    await host.surface.listView({ offline: true })

    // then
    expect(host.calls()).toBe(1)
  })

  test("#given an enumeration still running past the cache window #when a second caller asks for a view #then both share the one enumeration", async () => {
    // given
    const host = slowHost()
    const first = host.surface.listView({ offline: true })
    await untilEnumerating(host)
    host.advance(SLOW_ENUMERATION_MS)

    // when
    const second = host.surface.listView({ offline: true })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    host.finishEnumeration()
    await Promise.all([first, second])

    // then
    expect(host.calls()).toBe(1)
  })

  test("#given a finished enumeration #when a full cache window passes after it finished #then the next view enumerates again", async () => {
    // given
    const host = slowHost()
    const first = host.surface.listView({ offline: true })
    await untilEnumerating(host)
    host.finishEnumeration()
    await first

    // when
    host.advance(HOST_ENDPOINTS_CACHE_TTL_MS)
    await host.surface.listView({ offline: true })

    // then
    expect(host.calls()).toBe(2)
  })

  test("#given an enumeration that never settles #when the clock moves far past any bound #then the next view starts a fresh one and the stuck answer is never reused", async () => {
    // given (#13009 item 1)
    const host = slowHost([{ socket: "/tmp/omo-enum-cache-stale.sock", reachable: false, session_paths: [] }])
    const stuck = host.surface.listView({ offline: true })
    await untilEnumerating(host)
    try {
      // when
      host.advance(10 * 60_000)
      const fresh = await within(host.surface.listView({ offline: true }), "a view behind a stuck enumeration")

      // then
      expect(host.calls()).toBe(2)
      expect(fresh.hosts.map((entry) => entry.socket)).toEqual(["/tmp/omo-enum-cache-missing.sock"])
    } finally {
      host.finishEnumeration()
      await stuck
    }
    const after = await host.surface.listView({ offline: true })
    expect(host.calls()).toBe(2)
    expect(after.hosts.map((entry) => entry.socket)).toEqual(["/tmp/omo-enum-cache-missing.sock"])
  })

  test("#given an enumeration that has not answered #when a caller arrives just before and then at its deadline #then the first shares it and the second starts a fresh one", async () => {
    // given (#13009 item 1, the bound itself)
    const host = slowHost()
    const stuck = host.surface.listView({ offline: true })
    await untilEnumerating(host)
    try {
      // when
      host.advance(HOST_ENDPOINTS_ENUMERATION_DEADLINE_MS - 1)
      const sharing = host.surface.listView({ offline: true })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      const sharedCalls = host.calls()
      host.advance(1)
      await within(host.surface.listView({ offline: true }), "a view at the enumeration deadline")

      // then
      expect(sharedCalls).toBe(1)
      expect(host.calls()).toBe(2)
      host.finishEnumeration()
      await sharing
    } finally {
      host.finishEnumeration()
      await stuck
    }
  })

  test.each(["rpc_host", "tui"] as const)(
    "#given a slow enumeration in flight #when a send lists a published %s owner by durable id #then it answers without waiting for the enumeration",
    async (kind) => {
      // given (#13009 item 2)
      const host = slowHost()
      const view = host.surface.listView({ offline: true })
      await untilEnumerating(host)
      try {
        // when
        const target = await within(
          host.surface.listTarget("durable-13009", {
            kind,
            socket: "/tmp/omo-enum-cache-owner.sock",
            routing_id: null,
            durable_session_id: "durable-13009",
          }),
          "listTarget behind a running enumeration",
        )

        // then
        expect(host.calls()).toBe(1)
        expect(target.sessions).toEqual([])
        expect(target.hosts.map((entry) => [entry.socket, entry.alive])).toEqual([
          ["/tmp/omo-enum-cache-owner.sock", false],
        ])
      } finally {
        host.finishEnumeration()
        await view
      }
    },
  )
})
