import { afterEach, describe, expect, test } from "bun:test"

import type { EnsureHostInput, HostDecision, TaskDaemonHostPort } from "../lazy/senpi-barrel"
import { DAEMON_LAUNCH_FIXTURE } from "./rpc-host/__fixtures__/daemon-launch"
import type { FakeHost } from "./rpc-host/__fixtures__/fake-host"
import type { ReattachOutcomeInfo } from "./rpc-host/handle-reattach"
import { ensureTaskDaemon, type EnsureTaskDaemonInput } from "./rpc-host/daemon"
import { RunnerError } from "./in-process/runner-error"
import { isHostSessionHandle } from "./rpc-host"
import { childSpec, ensuredDaemon, hostRunnerHarness } from "./rpc-host.test-support"

// The daemon ensure is cached per socket for TASK_DAEMON_CACHE_TTL_MS. A host that dies inside that
// window must not leave the cache answering for it: the next spawn, and a live child's reattach,
// re-ensure the endpoint instead of opening against the dead one (host_unreachable).

const { fakeHost, runnerOver, runnerWithout, release } = hostRunnerHarness()

afterEach(async () => {
  await release()
})

const NO_WAIT = { reattachDelaysMs: [0, 0, 0], sleep: () => Promise.resolve() } as const

/**
 * The engine's ensure over a fake host: `start` when nothing answers (the ensure brings the host back
 * on its socket, as the engine's spawn would), `reuse` otherwise. The clock never moves, so every
 * ensure after the first is a cache hit unless something dropped the entry.
 */
function engineOver(host: FakeHost): { readonly ensure: (input: EnsureTaskDaemonInput) => ReturnType<typeof ensureTaskDaemon>; readonly starts: EnsureHostInput[] } {
  const starts: EnsureHostInput[] = []
  const port: TaskDaemonHostPort = {
    engineBuildIdentity: () => ({ text: "2026.9.18", ordinal: [2026, 9, 18, 0, 0], scheme: "epoch" }),
    probeHost: () => host.probeProtocolInfo(),
    decideHostAction: (_client, running): HostDecision =>
      running === undefined
        ? { action: "start", reason: "no_host", upgradeable: false }
        : { action: "reuse", reason: "compatible", upgradeable: false },
    ensureHost: async (input) => {
      if ((await host.probeProtocolInfo()) === undefined) {
        starts.push(input)
        await host.restart()
      }
      return { pid: 4242, socket: input.socket, reused: false }
    },
  }
  return {
    starts,
    ensure: (input) =>
      ensureTaskDaemon({
        ...input,
        ports: {
          host: port,
          launchSpec: { path: DAEMON_LAUNCH_FIXTURE.specPath, spec: DAEMON_LAUNCH_FIXTURE.spec },
          platform: "darwin",
          bunRuntimeAvailable: true,
          now: () => 1_000,
        },
      }),
  }
}

describe("RpcHostRunner ensure cache after a host death", () => {
  test("#given an ensure cached moments before its host died #when a child spawns #then the endpoint is re-ensured and the child runs", async () => {
    // given
    const host = await fakeHost()
    const engine = engineOver(host)
    const runner = runnerOver(host, { ensureDaemon: engine.ensure })
    await engine.ensure({ agentDir: "/tmp/unused", env: {}, policy: "upgrade", socket: host.socketPath })
    host.crash()

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(isHostSessionHandle(handle)).toBe(true)
    expect(engine.starts).toHaveLength(1)
    await handle.terminate()
  })

  test("#given an endpoint that ensures but never answers the open #when a child spawns #then it is ensured exactly twice and fails host_unreachable", async () => {
    // given
    let ensures = 0
    const runner = runnerWithout({
      ensureDaemon: () => {
        ensures += 1
        return Promise.resolve(ensuredDaemon("/tmp/dh-30-unreached.sock"))
      },
    })
    const breaker = Promise.withResolvers<"timed out">()
    const timer = setTimeout(() => breaker.resolve("timed out"), 3_000)

    // when
    const failure = await Promise.race([
      runner.start(childSpec()).then(
        () => "started",
        (error: unknown) => error,
      ),
      breaker.promise,
    ])
    clearTimeout(timer)

    // then
    expect(failure).not.toBe("timed out")
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "host_unavailable",
      reason: "host_unreachable",
    })
    expect(ensures).toBe(2)
  })

  test("#given a live child whose host dies #when its transport loss is observed #then its reattach re-ensures the endpoint instead of trusting the cached one", async () => {
    // given
    const host = await fakeHost()
    const engine = engineOver(host)
    const outcome = Promise.withResolvers<ReattachOutcomeInfo>()
    const runner = runnerOver(host, {
      ...NO_WAIT,
      ensureDaemon: engine.ensure,
      shardEvents: { onReattachOutcome: (info) => outcome.resolve(info) },
    })
    const handle = await runner.start(childSpec())

    // when
    host.crash()
    const reported = await outcome.promise

    // then
    expect(reported.outcome).not.toBe("lost")
    expect(engine.starts).toHaveLength(1)
    await handle.terminate()
  })
})
