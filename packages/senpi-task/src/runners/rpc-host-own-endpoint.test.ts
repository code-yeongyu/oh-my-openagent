import { afterEach, describe, expect, test } from "bun:test"

import type { SenpiHostProtocolInfo } from "../lazy/senpi-barrel"
import { RunnerError } from "./in-process/runner-error"
import { isHostSessionHandle, RpcHostRunner } from "./rpc-host"
import type { HostSessionParked } from "./rpc-host/session-client"
import type { RpcChildHandle } from "./types"
import { SHARD_KEY_CONTEXT, TREE_KEY_CONTEXT, type ShardResolution } from "./rpc-host/shard-socket"
import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"
import { cleanupTempDirs, ensureRecorder, posixShardTest, shardEndpoint, tempDir, type ShardEndpoint } from "./rpc-host-endpoint.test-support"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver } = harness

afterEach(async () => {
  await harness.release()
  cleanupTempDirs()
})

const TREE_KEY = "00000000000000e1"

function inherited(shard: ShardEndpoint): ShardResolution {
  return { socket: shard.socket, shard: { kind: "p", key: shard.key, ownerSessionId: "<inherited>", inherited: true }, root: "primary" }
}

function answering(instanceId: string, protocolVersion = 1): () => Promise<SenpiHostProtocolInfo> {
  return () =>
    Promise.resolve({
      protocolVersion,
      instanceId,
      generation: instanceId === "H1" ? 1 : 2,
      engineVersion: "2026.9.27",
      engineOrdinal: [2026, 9, 27, 0, 0],
      capabilities: ["multi_session", "extension_events", "session_context", "session_kind", "generation_handoff"],
    })
}

function parkedOnce(handle: RpcChildHandle): Promise<HostSessionParked> {
  if (!isHostSessionHandle(handle)) throw new Error("not a host-session handle")
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the child to park, it never did")), 5_000)
    handle.onParked((event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

function openContexts(commands: readonly { readonly type: string; readonly payload: Readonly<Record<string, unknown>> }[]) {
  return commands.filter((command) => command.type === "open_session").map((command) => command.payload["context"])
}

describe("a child inside a host attaches to its tree's shard and never ensures it", () => {
  for (const instance of ["H1", "H2"] as const) {
    posixShardTest(`#given an inherited shard whose probe answers ${instance} #when a grandchild starts #then it opens there with zero ensures`, async () => {
      // given - H2 is the successor that took the public path in a handoff; this session runs in H1
      const host = await fakeHost()
      const shard = shardEndpoint(host, TREE_KEY)
      const ensure = ensureRecorder()
      const probes: string[] = []
      const probe = answering(instance)
      const runner = runnerOver(host, {
        ensureDaemon: ensure.ensure,
        shardResolver: () => inherited(shard),
        ownHostSocket: () => shard.socket,
        probeHost: (socket) => (probes.push(socket), probe()),
      })

      // when
      const handle = await runner.start(childSpec())

      // then
      expect(ensure.inputs).toEqual([])
      expect(probes).toEqual([shard.socket])
      expect(isHostSessionHandle(handle) ? handle.hostSession.socket : undefined).toBe(shard.socket)
      expect(openContexts(host.commands)).toEqual([
        expect.objectContaining({ [TREE_KEY_CONTEXT]: TREE_KEY, [SHARD_KEY_CONTEXT]: TREE_KEY }),
      ])
      await handle.terminate()
    })
  }

  const refusals = [
    { name: "a silent probe", probe: () => Promise.resolve(undefined) },
    { name: "a protocol mismatch", probe: answering("H1", 2) },
  ] as const
  for (const refusal of refusals) {
    test(`#given an inherited shard with ${refusal.name} #when a grandchild starts #then own_host_unreachable with zero ensures, opens or fallback starts`, async () => {
      // given
      const host = await fakeHost()
      const shard = shardEndpoint(host, TREE_KEY)
      const ensure = ensureRecorder()
      const fallback = fakeFallbackRunner()
      const runner = runnerOver(host, {
        ensureDaemon: ensure.ensure,
        fallback,
        shardResolver: () => inherited(shard),
        ownHostSocket: () => shard.socket,
        probeHost: refusal.probe,
      })

      // when
      const failure = await runner.start(childSpec()).catch((error: unknown) => error)

      // then
      expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
        kind: "host_unavailable",
        reason: "own_host_unreachable",
      })
      expect(ensure.inputs).toEqual([])
      expect(fallback.starts).toEqual([])
      expect(openContexts(host.commands)).toEqual([])
    })
  }

  test("#given a context whose host_socket names a DIFFERENT endpoint than the inherited shard #when the shard is silent #then it is still never ensured", async () => {
    // given - a forged or foreign host_socket: `inherited` alone forbids the ensure
    const host = await fakeHost()
    const shard = shardEndpoint(host, TREE_KEY)
    const ensure = ensureRecorder()
    const runner = runnerOver(host, {
      ensureDaemon: ensure.ensure,
      shardResolver: () => inherited(shard),
      ownHostSocket: () => "/tmp/dh-t8-foreign/rpc.sock",
      probeHost: () => Promise.resolve(undefined),
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("own_host_unreachable")
    expect(ensure.inputs).toEqual([])
  })

  posixShardTest("#given a child inside a host on an engine that does not stamp host_socket #when its shard dies under it #then it parks own_host_unreachable and never ensures (spawns) a supervisor", async () => {
    // given - senpi 2026.9.27: ownHostSocket is unknown, the inherited shard_key is the only inside-host fact
    const host = await fakeHost()
    const shard = shardEndpoint(host, TREE_KEY)
    const ensure = ensureRecorder()
    const notices: string[] = []
    const runner = runnerOver(host, {
      reattachDelaysMs: [0, 0, 0],
      sleep: () => Promise.resolve(),
      ensureDaemon: ensure.ensure,
      shardResolver: () => inherited(shard),
      ownHostSocket: () => undefined,
      insideHost: () => true,
      onNotice: (token) => notices.push(token),
    })
    const handle = await runner.start(childSpec())
    const settled = Promise.race([parkedOnce(handle), handle.waitForExit()])

    // when
    host.crash()

    // then
    const outcome = await settled
    expect(ensure.inputs.map((input) => input.socket)).toEqual([])
    expect(outcome).toMatchObject({ reason: "own_host_unreachable" })
    expect(notices).toEqual(["host_notice:own_host_unreachable"])
  })
})

describe("a root session's child carries its tree key and there is no machine-wide default", () => {
  posixShardTest("#given a root resolution #when a child starts #then the ensure names the shard and the open carries tree_key and shard_key", async () => {
    // given
    const host = await fakeHost()
    const shard = shardEndpoint(host, "00000000000000e2")
    const ensure = ensureRecorder()
    const runner = runnerOver(host, { ensureDaemon: ensure.ensure, shardResolver: () => shard.resolution() })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(ensure.inputs.map((input) => input.socket)).toEqual([shard.socket])
    expect(openContexts(host.commands)).toEqual([
      expect.objectContaining({ [TREE_KEY_CONTEXT]: shard.key, [SHARD_KEY_CONTEXT]: shard.key }),
    ])
    await handle.terminate()
  })

  test("#given a runner built without a shard resolver #when a child starts #then it fails loudly and nothing is ensured", async () => {
    // given - the type forbids it; a JavaScript caller must still never reach rpc.sock
    const ensure = ensureRecorder()
    const runner = new RpcHostRunner(
      // @ts-expect-error shardResolver is required: a task child has no machine-wide default endpoint
      {
        policy: "upgrade",
        agentDir: tempDir("dh-t8-agent-"),
        storeDir: "/tmp/dh-t8-store",
        ownHostSocket: () => undefined,
        onNotice: () => undefined,
        modelAdmission: () => Promise.resolve(),
        ensureDaemon: ensure.ensure,
      },
    )

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "host_unavailable",
      reason: "shard_identity_missing",
    })
    expect(ensure.inputs).toEqual([])
  })
})
