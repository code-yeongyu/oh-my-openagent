import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "./in-process/runner-error"
import type { FakeHost } from "./rpc-host/__fixtures__/fake-host"
import { HostUnavailableError } from "./rpc-host/daemon"
import { HostSessionClient } from "./rpc-host/session-client"
import type { HostSessionOpenInput } from "./rpc-host/session-transport"
import { isHostSessionHandle, type HostSessionChannel } from "./rpc-host"
import { childSpec, ensuredDaemon, fakeFallbackRunner, hostRunnerHarness, stubChannel } from "./rpc-host.test-support"

const { fakeHost, runnerOver, runnerWithout, release } = hostRunnerHarness()
const opened: HostSessionClient[] = []

afterEach(async () => {
  for (const client of opened.splice(0)) await client.detach()
  await release()
})

const PRE_ACK_TIMEOUT = "Timeout waiting for response to open_session. Stderr: "

function timedOutChannel(paths: string[]): HostSessionChannel {
  return {
    ...stubChannel(undefined),
    open: (input: HostSessionOpenInput) => {
      paths.push(input.sessionPath)
      return Promise.reject(new Error(PRE_ACK_TIMEOUT))
    },
  }
}

function realClient(host: FakeHost): HostSessionClient {
  const client = new HostSessionClient({
    socketPath: host.socketPath,
    ports: { probeProtocolInfo: () => host.probeProtocolInfo() },
  })
  opened.push(client)
  return client
}

describe("RpcHostRunner busy host (omo#9067)", () => {
  test("#given a busy child on a recorded shard #when the start retries #then ensure, probe and connect stay on that socket without fallback", async () => {
    // given
    const socket = "/tmp/p-0123456789abcdef.sock"
    const ensured: Array<string | undefined> = []
    const probes: string[] = []
    const accepts: string[] = []
    const fallback = fakeFallbackRunner()
    let clock = 0
    const runner = runnerWithout({
      fallback,
      now: () => clock,
      admissionWaitMs: 1_000,
      sleep: async (ms) => { clock += ms },
      shardResolver: () => { throw new Error("a recorded child must not derive a new endpoint") },
      ensureDaemon: async (input) => {
        ensured.push(input.socket)
        return ensuredDaemon(input.socket ?? "/tmp/rpc.sock")
      },
      createClient: (socketPath) => {
        const client = new HostSessionClient({
          socketPath,
          ports: {
            probeProtocolInfo: async (path) => {
              probes.push(path)
              return undefined
            },
            socketAccepts: async (path) => {
              accepts.push(path)
              return path === socket
            },
          },
        })
        opened.push(client)
        return client
      },
    })

    // when
    const failure = await runner.start(childSpec({ hostSocket: socket, resumeSessionPath: "/tmp/recorded.jsonl" }))
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("host_busy")
    expect(ensured).toEqual([socket, socket])
    expect(probes).toEqual([socket, socket])
    expect(accepts).toEqual([socket, socket])
    expect(fallback.starts).toEqual([])
  })

  test("#given the ensure refuses host_busy once #when a child starts #then the runner waits, ensures again and starts it on the same host", async () => {
    // given
    const host = await fakeHost()
    const waits: number[] = []
    const notes: string[] = []
    let ensures = 0
    const runner = runnerOver(host, {
      ensureDaemon: () => {
        ensures += 1
        if (ensures === 1) return Promise.reject(new HostUnavailableError("host_busy", { fallbackAllowed: false }))
        return Promise.resolve(ensuredDaemon(host.socketPath))
      },
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
      onWarning: (message) => {
        notes.push(message)
      },
    })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(ensures).toBe(2)
    expect(waits).toEqual([1_000])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toStartWith("host_busy")
    expect(host.sessions()).toHaveLength(1)
    expect(isHostSessionHandle(handle)).toBe(true)
    await handle.terminate()
  })

  test("#given an open the host never acknowledged #when it times out #then the runner reopens the SAME session path and the host holds one session", async () => {
    // given
    const host = await fakeHost()
    const timedOutPaths: string[] = []
    let clients = 0
    const runner = runnerOver(host, {
      createClient: () => {
        clients += 1
        return clients === 1 ? timedOutChannel(timedOutPaths) : realClient(host)
      },
      sleep: () => Promise.resolve(),
    })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(clients).toBe(2)
    expect(host.sessions()).toHaveLength(1)
    expect(host.sessions()[0]?.sessionPath).toBe(timedOutPaths[0])
    await handle.terminate()
  })

  test("#given a reopen after a timeout finds the first open still building #when the path answers session_path_in_use #then the runner keeps waiting and adopts the session", async () => {
    // given
    const host = await fakeHost()
    let clients = 0
    const runner = runnerOver(host, {
      createClient: () => {
        clients += 1
        if (clients === 1) return timedOutChannel([])
        if (clients === 2) host.failOpen({ code: "session_path_in_use", data: { retry_after_ms: 500 } })
        if (clients === 3) host.failOpen(undefined)
        return realClient(host)
      },
      sleep: () => Promise.resolve(),
    })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(clients).toBe(3)
    expect(host.sessions()).toHaveLength(1)
    await handle.terminate()
  })

  test("#given a fresh start whose path is held by someone else #when the open answers session_path_in_use #then it fails at once, never waiting", async () => {
    // given
    const host = await fakeHost({ openFailure: { code: "session_path_in_use", data: { retry_after_ms: 500 } } })
    const waits: number[] = []
    const runner = runnerOver(host, {
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("session_path_in_use")
    expect(waits).toEqual([])
  })

  test("#given a dead host #when the ensure reports it unreachable #then the start fails at once without waiting", async () => {
    // given
    const waits: number[] = []
    const fallback = fakeFallbackRunner()
    const host = await fakeHost()
    const runner = runnerOver(host, {
      fallback,
      ensureDaemon: () =>
        Promise.reject(new HostUnavailableError("host_unreachable", { fallbackAllowed: false })),
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("host_unreachable")
    expect(waits).toEqual([])
    expect(fallback.starts).toEqual([])
  })

  test("#given a host that stays busy #when the wait window runs out #then the start fails typed host_busy after bounded waits and never falls back", async () => {
    // given
    let clock = 1_700_000_000_000
    const waits: number[] = []
    const fallback = fakeFallbackRunner()
    const host = await fakeHost()
    const runner = runnerOver(host, {
      fallback,
      admissionWaitMs: 60_000,
      now: () => clock,
      ensureDaemon: () => Promise.reject(new HostUnavailableError("host_busy", { fallbackAllowed: false })),
      sleep: (ms) => {
        waits.push(ms)
        clock += ms
        return Promise.resolve()
      },
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("host_unavailable")
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("host_busy")
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(60_000)
    expect(waits.length).toBeGreaterThan(3)
    expect(fallback.starts).toEqual([])
  })
})

describe("HostSessionClient silent probe (omo#9067)", () => {
  test("#given a daemon that accepts connections but does not answer its probe #when a child opens #then the open reports host_busy, not host_unreachable", async () => {
    // given
    const client = new HostSessionClient({
      socketPath: "/tmp/omo-9067-busy.sock",
      ports: { probeProtocolInfo: () => Promise.resolve(undefined), socketAccepts: () => Promise.resolve(true) },
    })

    // when
    const failure = await client.open({ sessionPath: "/tmp/omo-9067/s.jsonl", cwd: "/tmp" } as HostSessionOpenInput).catch((error: unknown) => error)

    // then
    expect(failure instanceof HostUnavailableError ? failure.reason : undefined).toBe("host_busy")
  })

  test("#given a daemon socket that refuses #when a child opens #then the open still reports host_unreachable", async () => {
    // given
    const client = new HostSessionClient({
      socketPath: "/tmp/omo-9067-dead.sock",
      ports: { probeProtocolInfo: () => Promise.resolve(undefined), socketAccepts: () => Promise.resolve(false) },
    })

    // when
    const failure = await client.open({ sessionPath: "/tmp/omo-9067/s.jsonl", cwd: "/tmp" } as HostSessionOpenInput).catch((error: unknown) => error)

    // then
    expect(failure instanceof HostUnavailableError ? failure.reason : undefined).toBe("host_unreachable")
  })
})
