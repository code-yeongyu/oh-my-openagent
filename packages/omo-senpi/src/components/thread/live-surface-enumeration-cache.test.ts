// #12989: on a host where one endpoint enumeration (`host status --all`) takes longer than the cache window, the
// window was stamped when the enumeration started, so its answer arrived already expired: the next view enumerated
// again, and a caller arriving while it ran started a second one. A send paid one enumeration per view.
import { describe, expect, test } from "bun:test"
import { createLiveThreadSurface, HOST_ENDPOINTS_CACHE_TTL_MS, type HostEndpointReport } from "./live-surface"

const SLOW_ENUMERATION_MS = HOST_ENDPOINTS_CACHE_TTL_MS + 1_000

function slowHost() {
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
      if (calls === 1) await new Promise<void>((done) => pending.push(done))
      return []
    },
  })
  return {
    surface,
    calls: () => calls,
    advance: (ms: number) => { clock += ms },
    finishEnumeration: () => { for (const done of pending.splice(0)) done() },
    enumerating: () => pending.length > 0,
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
})
