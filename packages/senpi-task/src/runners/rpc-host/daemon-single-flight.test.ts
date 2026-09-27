import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { EnsureHostInput, TaskDaemonHostPort } from "../../lazy/senpi-barrel"
import { DAEMON_LAUNCH_FIXTURE } from "./__fixtures__/daemon-launch"
import {
  ensureTaskDaemon,
  HostUnavailableError,
  TASK_DAEMON_REQUIRED_CAPABILITIES,
} from "./daemon"

function delayedHost(
  ensure: (input: EnsureHostInput) => Promise<{ pid: number; socket: string; reused: boolean }>,
): TaskDaemonHostPort & { readonly ensured: EnsureHostInput[] } {
  const ensured: EnsureHostInput[] = []
  return {
    ensured,
    engineBuildIdentity: () => ({
      text: "2026.9.18+1758000000.abc1234",
      ordinal: [2026, 9, 18, 0, 1_758_000_000],
      scheme: "epoch",
    }),
    probeHost: async () => ({
      protocolVersion: 1,
      instanceId: "instance-single-flight",
      generation: 1,
      engineVersion: "2026.9.18+1758000000.abc1234",
      engineOrdinal: [2026, 9, 18, 0, 1_758_000_000],
      capabilities: [...TASK_DAEMON_REQUIRED_CAPABILITIES, "generation_handoff"],
    }),
    decideHostAction: () => ({ action: "reuse", reason: "compatible", upgradeable: true }),
    ensureHost: async (input) => {
      ensured.push(input)
      return ensure(input)
    },
  }
}

function ensureInput(host: TaskDaemonHostPort, agentDir: string) {
  return {
    agentDir,
    env: DAEMON_LAUNCH_FIXTURE.parentEnv,
    policy: "upgrade" as const,
    ports: {
      host,
      launchSpec: { path: DAEMON_LAUNCH_FIXTURE.specPath, spec: DAEMON_LAUNCH_FIXTURE.spec },
      platform: "darwin" as const,
      bunRuntimeAvailable: true,
    },
  }
}

describe("ensureTaskDaemon single-flight", () => {
  test("#given four concurrent cold starts on one socket #when the ensure is delayed #then all callers share one in-flight ensure", async () => {
    // given
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const host = delayedHost(async (input) => {
      entered.resolve()
      await release.promise
      return { pid: 4242, socket: input.socket, reused: true }
    })
    const input = ensureInput(host, join("/tmp", "agent-concurrent-single-flight"))

    // when
    const starts = Array.from({ length: 4 }, () => ensureTaskDaemon(input))
    await entered.promise
    await Promise.resolve()
    await Promise.resolve()

    // then
    expect(host.ensured).toHaveLength(1)
    release.resolve()
    const results = await Promise.all(starts)
    expect(results.map((result) => result.socket)).toEqual(Array(4).fill(join(input.agentDir, "rpc", "rpc.sock")))
  })

  test("#given a shared in-flight ensure rejects #when all waiters fail and a later caller retries #then the failure is not cached", async () => {
    // given
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let attempts = 0
    const host = delayedHost(async (input) => {
      attempts += 1
      entered.resolve()
      await release.promise
      if (attempts === 1) {
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" })
      }
      return { pid: 4242, socket: input.socket, reused: true }
    })
    const input = ensureInput(host, join("/tmp", "agent-concurrent-retry"))
    const starts = Array.from({ length: 4 }, () => ensureTaskDaemon(input).catch((error: unknown) => error))
    await entered.promise
    await Promise.resolve()
    await Promise.resolve()

    // when
    release.resolve()
    const failures = await Promise.all(starts)
    const retried = await ensureTaskDaemon(input)

    // then
    expect(host.ensured).toHaveLength(2)
    expect(failures.every((failure) => failure instanceof HostUnavailableError)).toBe(true)
    expect(failures).toEqual(
      Array(4).fill(expect.objectContaining({ reason: "ensure_timed_out" })),
    )
    expect(retried.socket).toBe(join(input.agentDir, "rpc", "rpc.sock"))
  })

  test("#given the engine refuses ensure for host_busy #when ensuring #then it stays an ensure failure instead of a timeout", async () => {
    // given
    const host = delayedHost(async () => {
      const refusal = new Error("task host ensure refused (host_busy) at /tmp/busy.sock")
      refusal.name = "HostEnsureRefusedError"
      throw refusal
    })

    // when
    const failure = await ensureTaskDaemon(
      ensureInput(host, join("/tmp", "agent-host-busy-refusal")),
    ).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect(failure).toMatchObject({ reason: "ensure_failed" })
  })

  test("#given the pinned engine's readiness deadline envelope #when ensuring #then it is classified as a timeout without exposing its diagnostic", async () => {
    // given
    const host = delayedHost(async () => {
      throw new Error(
        "spawned RPC socket host did not answer get_protocol_info within 20000ms\nprivate stderr diagnostic",
      )
    })

    // when
    const failure = await ensureTaskDaemon(
      ensureInput(host, join("/tmp", "agent-readiness-timeout")),
    ).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect(failure).toMatchObject({ reason: "ensure_timed_out" })
  })
})
