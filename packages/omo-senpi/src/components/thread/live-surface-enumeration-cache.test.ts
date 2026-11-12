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
    monotonic: () => clock,
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

  describe("one enumeration shared by every surface of the process (#12989)", () => {
    function sharedHost(enumerations: Map<string, never>, agentDir: string, gate?: Promise<void>) {
      const counter = { calls: 0 }
      let clock = 1_000
      const surface = createLiveThreadSurface(
        {} as never,
        {
          env: { SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock", OMO_CODING_AGENT_DIR: agentDir },
          exists: () => false,
          registry: async () => [],
          now: () => clock,
          monotonic: () => clock,
          enumerations,
          statusAll: async (): Promise<readonly HostEndpointReport[]> => {
            counter.calls += 1
            if (gate !== undefined && counter.calls === 1) await gate
            return []
          },
        } as never,
      )
      return {
        surface,
        counter,
        advance: (ms: number) => {
          clock += ms
        },
      }
    }

    test("#given two sessions' surfaces over one agent dir #when both list inside the cache window #then the engine is asked once", async () => {
      // given
      const enumerations = new Map<string, never>()
      const first = sharedHost(enumerations, "/tmp/omo-enum-shared-a")
      const second = sharedHost(enumerations, "/tmp/omo-enum-shared-a")

      // when
      await first.surface.listView({ offline: true })
      await second.surface.listView({ offline: true })

      // then
      expect(first.counter.calls + second.counter.calls).toBe(1)
    })

    test("#given surfaces over two different agent dirs #when both list inside the cache window #then each agent dir is enumerated on its own", async () => {
      // given
      const enumerations = new Map<string, never>()
      const first = sharedHost(enumerations, "/tmp/omo-enum-shared-a")
      const second = sharedHost(enumerations, "/tmp/omo-enum-shared-b")

      // when
      await first.surface.listView({ offline: true })
      await second.surface.listView({ offline: true })

      // then
      expect([first.counter.calls, second.counter.calls]).toEqual([1, 1])
    })

    test("#given one session's enumeration stuck past its deadline #when another session of the process lists #then it starts a fresh enumeration instead of waiting", async () => {
      // given
      const enumerations = new Map<string, never>()
      let release: () => void = () => {}
      const gate = new Promise<void>((done) => {
        release = done
      })
      const stuck = sharedHost(enumerations, "/tmp/omo-enum-shared-a", gate)
      const pending = stuck.surface.listView({ offline: true })
      for (let turn = 0; turn < 100 && stuck.counter.calls === 0; turn++) await Promise.resolve()
      expect(stuck.counter.calls).toBe(1)
      try {
        // when
        const other = sharedHost(enumerations, "/tmp/omo-enum-shared-a")
        other.advance(HOST_ENDPOINTS_ENUMERATION_DEADLINE_MS)
        await within(other.surface.listView({ offline: true }), "a second session behind a stuck shared enumeration")

        // then
        expect(other.counter.calls).toBe(1)
      } finally {
        release()
        await pending
      }
    })
  })

  describe("review follow-ups of #13231 and #13236", () => {
    test("#given an enumeration still running #when only the wall clock jumps forward past the deadline #then the next caller shares it instead of starting a second one", async () => {
      // given (L1: the deadline is timed on the monotonic clock, so a wall-clock jump is not elapsed time)
      let wall = 1_000
      let calls = 0
      const pending: Array<() => void> = []
      const surface = createLiveThreadSurface(
        {} as never,
        {
          env: { SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock" },
          exists: () => false,
          registry: async () => [],
          now: () => wall,
          monotonic: () => 1_000,
          statusAll: async (): Promise<readonly HostEndpointReport[]> => {
            calls += 1
            if (calls === 1) await new Promise<void>((done) => pending.push(done))
            return []
          },
        } as never,
      )
      const first = surface.listView({ offline: true })
      for (let turn = 0; turn < 100 && pending.length === 0; turn++) await Promise.resolve()
      expect(pending).toHaveLength(1)

      // when
      wall += 10 * 60_000
      const second = surface.listView({ offline: true })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      const callsAfterJump = calls
      for (const done of pending.splice(0)) done()
      await Promise.all([first, second])

      // then
      expect(callsAfterJump).toBe(1)
    })

    test("#given an abandoned enumeration that answers after a newer one #when its late answer names a socket the newer one recorded as another kind #then the newer kind stays and the old caller still gets its list", async () => {
      // given (L2)
      const socket = "/tmp/omo-enum-kind-owner.sock"
      let clock = 1_000
      let calls = 0
      const secretReads: string[] = []
      let releaseOld: () => void = () => {}
      const surface = createLiveThreadSurface(
        {} as never,
        {
          env: { SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock" },
          exists: (path: string) => path === socket,
          registry: async () => [],
          now: () => clock,
          monotonic: () => clock,
          readSecret: (path: string) => {
            secretReads.push(path)
            throw new Error("no secret in this test")
          },
          statusAll: async (): Promise<readonly HostEndpointReport[]> => {
            calls += 1
            if (calls === 1) {
              await new Promise<void>((done) => {
                releaseOld = done
              })
              return [{ socket, reachable: false, session_paths: [], endpoint_kind: "rpc_host" }]
            }
            return [{ socket, reachable: false, session_paths: [], endpoint_kind: "tui" }]
          },
        } as never,
      )
      const old = surface.listView({ offline: true })
      for (let turn = 0; turn < 100 && calls === 0; turn++) await Promise.resolve()
      clock += HOST_ENDPOINTS_ENUMERATION_DEADLINE_MS
      await within(surface.listView({ offline: true }), "the view that replaced the abandoned enumeration")

      // when
      releaseOld()
      const late = await old
      secretReads.length = 0
      await surface
        .endpoint(socket)
        .getState("probe")
        .catch(() => undefined)

      // then
      expect(late.hosts.map((host) => [host.socket, host.endpoint_kind])).toContainEqual([socket, "rpc_host"])
      expect(secretReads).toEqual([socket])
    })

    test("#given a surface whose env moves to another agent dir between calls #when it lists again #then the new agent dir is enumerated under its own key and the old entry keeps the old answer", async () => {
      // given (L3)
      const enumerations = new Map<string, never>()
      const env: Record<string, string> = {
        SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock",
        OMO_CODING_AGENT_DIR: "/tmp/omo-enum-env-a",
      }
      let calls = 0
      const surface = createLiveThreadSurface(
        {} as never,
        {
          env,
          exists: () => false,
          registry: async () => [],
          now: () => 1_000,
          monotonic: () => 1_000,
          enumerations,
          statusAll: async (): Promise<readonly HostEndpointReport[]> => {
            calls += 1
            return []
          },
        } as never,
      )
      await surface.listView({ offline: true })

      // when
      env.OMO_CODING_AGENT_DIR = "/tmp/omo-enum-env-b"
      await surface.listView({ offline: true })

      // then
      expect(calls).toBe(2)
      const keys = [...enumerations.keys()]
      expect(keys).toHaveLength(2)
      expect(keys.filter((key) => key.includes("/tmp/omo-enum-env-a"))).toHaveLength(1)
      expect(keys.filter((key) => key.includes("/tmp/omo-enum-env-b"))).toHaveLength(1)
    })

    test("#given two surfaces with the real engine runner whose envs launch different engines #when both list over one shared map #then each engine gets its own entry", async () => {
      // given (L4: no statusAll, so the key carries the engine launch; SENPI_BIN names it without any engine installed)
      const enumerations = new Map<string, never>()
      const surfaceFor = (engine: string) =>
        createLiveThreadSurface(
          {} as never,
          {
            env: {
              SENPI_RPC_SOCKET: "/tmp/omo-enum-cache-missing.sock",
              OMO_CODING_AGENT_DIR: "/tmp/omo-enum-engine",
              SENPI_BIN: engine,
            },
            exists: () => false,
            registry: async () => [],
            now: () => 1_000,
            monotonic: () => 1_000,
            enumerations,
          } as never,
        )

      // when
      await within(surfaceFor("/bin/true").listView({ offline: true }), "a view enumerated by /bin/true")
      await within(surfaceFor("/bin/false").listView({ offline: true }), "a view enumerated by /bin/false")

      // then
      expect(enumerations.size).toBe(2)
    })
  })
})
