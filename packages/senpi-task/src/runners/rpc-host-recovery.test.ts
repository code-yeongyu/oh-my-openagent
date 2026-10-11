import { afterEach, describe, expect, test } from "bun:test"

import { HOST_SESSION_REATTACH_TAG } from "./rpc-host/reattach"
import { HostSessionClient } from "./rpc-host/session-client"
import { isHostSessionHandle } from "./rpc-host"
import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"
import type { RpcRunnerSpec } from "./types"
import { TRANSPORT_LOST_REASON } from "./rpc-host/transport-recovery"

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

    // when - registered before the trigger: the reattach can re-prompt before restart() resolves
    const continued = host.waitForCommand("prompt")
    await host.restart()
    const continuation = await continued

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

  test("#given a child that reattached after its daemon died #when the manager reads entries and switches sessions #then both are served by the NEW port and never by the dead one", async () => {
    // given - every session client the runner creates counts the queries it serves
    const host = await fakeHost()
    const served: Array<{ readonly client: HostSessionClient; readonly calls: string[] }> = []
    const runner = runnerOver(host, {
      ...NO_WAIT,
      createClient: (socketPath) => {
        const client = new HostSessionClient({ socketPath, ports: { probeProtocolInfo: () => host.probeProtocolInfo() } })
        const calls: string[] = []
        const getEntries = client.getEntries.bind(client)
        const switchSession = client.switchSession.bind(client)
        client.getEntries = (since) => {
          calls.push("get_entries")
          return getEntries(since)
        }
        client.switchSession = (target) => {
          calls.push("switch_session")
          return switchSession(target)
        }
        served.push({ client, calls })
        return client
      },
    })
    const handle = await runner.start(childSpec())
    const reattached = host.waitForCommand("prompt")
    await host.restart()
    await reattached

    // when
    const entries = await handle.getEntries?.()
    const switched = await handle.switchSession?.("/tmp/dh-30-state/sessions/st_30/other.jsonl")

    // then
    expect(served).toHaveLength(2)
    expect(served[0]?.calls).toEqual([])
    expect(served[1]?.calls).toEqual(["get_entries", "switch_session"])
    expect(entries).toEqual({ entries: [], leafId: null })
    expect(switched).toEqual({ cancelled: false })
    await handle.terminate()
    for (const { client } of served) await client.detach()
  })

  test("#given a reattached child whose continuation times out #when recovery cannot deliver #then it reports lost and settles the turn without reporting resumed (omo#9403)", async () => {
    const failureMessage = "Timeout waiting for response to prompt. Stderr: "
    // given - the client the runner creates for the new host never answers a prompt
    const host = await fakeHost()
    let created = 0
    const recoveryOutcomes: string[] = []
    const runner = runnerOver(host, {
      shardEvents: { onReattachOutcome: (info) => recoveryOutcomes.push(info.outcome) },
      ...NO_WAIT,
      createClient: (socketPath) => {
        const client = new HostSessionClient({ socketPath, ports: { probeProtocolInfo: () => host.probeProtocolInfo() } })
        created += 1
        if (created === 2) {
          const send = client.send.bind(client)
          client.send = (command) =>
            command.type === "prompt"
              ? Promise.reject(new Error(failureMessage))
              : send(command)
        }
        return client
      },
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const handle = await runner.start(childSpec())
      const settled = handle.waitForOutcome?.()
      if (settled === undefined) throw new Error("a host-session handle reports its turn outcome")

      // when
      await host.restart()
      const outcome = await settled
      await new Promise((resolve) => setImmediate(resolve))

      // then
      expect(outcome).toMatchObject({
        status: "error",
        failure: { kind: "child-prompt-failed", message: failureMessage },
      })
      expect(recoveryOutcomes).toEqual(["lost"])
      expect(unhandled).toEqual([])
      expect(handle.exitOutcome()).toBeUndefined()
      await handle.terminate()
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("#given a child mid-turn #when the daemon never comes back #then the child ends crashed with transport lost after the retries", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host, NO_WAIT)
    const handle = await runner.start(childSpec())

    // when
    host.crash()

    // then
    expect(await handle.waitForExit()).toMatchObject({ kind: "crashed", facts: { stderrTail: TRANSPORT_LOST_REASON } })
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

  test("#given one start waited on memory pressure #when a later unrelated start fails #then the pressure note does not outlive its admission episode", async () => {
    // given
    const host = await fakeHost({
      openFailure: { code: "host_memory_pressure", data: { rssMb: 8300, retry_after_ms: 30_000 } },
    })
    const notes = new Map<string, string>()
    const runner = runnerOver(host, {
      onWarning: (message) => {
        const token = message.split(" ")[0] ?? message
        notes.set(token, message)
        return () => {
          notes.delete(token)
        }
      },
      sleep: () => {
        host.failOpen(undefined)
        return Promise.resolve()
      },
    })
    const first = await runner.start(childSpec())
    await first.terminate()
    host.failOpen({ code: "open_failed" })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(failure).toMatchObject({ failure: { kind: "session_unavailable" } })
    expect([...notes.values()]).toEqual([])
  })
})
