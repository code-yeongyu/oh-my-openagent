import { afterEach, describe, expect, test } from "bun:test"

import { HOST_SESSION_REATTACH_TAG } from "./rpc-host/reattach"
import { isHostSessionHandle } from "./rpc-host"
import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"
import type { RpcRunnerSpec } from "./types"

// omo#8563: the runner owns the two recoveries a daemon child needs. A lost transport is
// re-ensured and the same session path reopened (bounded backoff), and a host that is above its
// memory refuse watermark (senpi#1905 `host_memory_pressure`) is an admission WAIT - the child
// starts when the host admits it, never on a per-child process.

const { fakeHost, runnerOver, release } = hostRunnerHarness()

afterEach(async () => {
  await release()
})

const NO_WAIT = { reattachDelaysMs: [0, 0, 0], sleep: () => Promise.resolve() } as const

describe("RpcHostRunner transport recovery", () => {
  test("#given a child mid-turn #when the daemon dies and a new one answers the socket #then the child reopens its path there and is re-prompted once", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host, NO_WAIT)
    const handle = await runner.start(childSpec())
    const sessionPath = host.sessions()[0]?.sessionPath ?? ""

    // when
    await host.restart()
    const continuation = await host.waitForCommand("prompt")

    // then
    expect(String(continuation.payload.message)).toContain(HOST_SESSION_REATTACH_TAG)
    expect(handle.exitOutcome()).toBeUndefined()
    expect(host.sessions().map((session) => session.sessionPath)).toEqual([sessionPath])
    expect(isHostSessionHandle(handle) ? handle.hostSession.sessionPath : undefined).toBe(sessionPath)
    const reopened = host.sessions()[0]
    if (reopened === undefined) throw new Error("the session was not reopened")
    host.completeTurn(reopened.routingId, "finished on the new host")
    expect(handle.lastAssistantText()).toBeUndefined()
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("finished on the new host")
    await handle.terminate()
  })

  test("#given a child mid-turn #when the daemon never comes back #then the child ends crashed with transport_gone after the retries", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host, NO_WAIT)
    const handle = await runner.start(childSpec())

    // when
    host.crash()

    // then
    expect(await handle.waitForExit()).toMatchObject({ kind: "crashed", facts: { stderrTail: "transport_gone" } })
  })
})

describe("RpcHostRunner memory admission", () => {
  test("#given a host above its refuse watermark #when a child starts #then the runner waits for the retry hint and starts once the host admits it, never on the fallback", async () => {
    // given
    const host = await fakeHost({
      openFailure: { code: "host_memory_pressure", data: { rssMb: 8300, retry_after_ms: 30_000 } },
    })
    const waits: number[] = []
    const fallback = fakeFallbackRunner()
    const runner = runnerOver(host, {
      fallback,
      sleep: (ms) => {
        waits.push(ms)
        host.failOpen(undefined)
        return Promise.resolve()
      },
    })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(waits).toEqual([30_000])
    expect(fallback.starts).toEqual([])
    expect(host.sessions()).toHaveLength(1)
    expect(isHostSessionHandle(handle)).toBe(true)
    await handle.terminate()
  })

  test("#given a host that stays above its refuse watermark #when the admission wait is exhausted #then the start fails typed and the fallback is never used", async () => {
    // given
    const host = await fakeHost({
      openFailure: { code: "host_memory_pressure", data: { rssMb: 8300, retry_after_ms: 30_000 } },
    })
    const fallback = fakeFallbackRunner()
    let clock = 1_700_000_000_000
    const waits: number[] = []
    const runner = runnerOver(host, {
      fallback,
      admissionWaitMs: 60_000,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms)
        clock += ms
        return Promise.resolve()
      },
    })

    // when
    const failure = await runner.start(childSpec() satisfies RpcRunnerSpec).catch((error: unknown) => error)

    // then
    expect(failure).toMatchObject({ failure: { kind: "session_unavailable" } })
    expect(String(failure)).toContain("host_memory_pressure")
    expect(waits).toEqual([30_000, 30_000])
    expect(fallback.starts).toEqual([])
    expect(host.sessions()).toHaveLength(0)
  })
})
