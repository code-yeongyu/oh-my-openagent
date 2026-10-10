import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EnsureHostInput, HostDecision, SenpiHostProtocolInfo, TaskDaemonHostPort } from "../../lazy/senpi-barrel"
import { DAEMON_LAUNCH_FIXTURE } from "./__fixtures__/daemon-launch"
import { ensureTaskDaemon, HostUnavailableError, isHostIncompatible, TASK_DAEMON_REQUIRED_CAPABILITIES } from "./daemon"
import { shardKey, shardMetaPath, shardSocketPathForKey } from "./shard-socket"

const ENGINE_TEXT = "2026.9.18+1758000000.abc1234"
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function running(): SenpiHostProtocolInfo {
  return {
    protocolVersion: 1,
    instanceId: "instance-a",
    generation: 1,
    engineVersion: ENGINE_TEXT,
    engineOrdinal: [2026, 9, 18, 0, 1_758_000_000],
    capabilities: [...TASK_DAEMON_REQUIRED_CAPABILITIES],
  }
}

/** A host port whose decision is "start" with nothing listening and "reuse" once something is. */
function hostPort(options: { readonly host?: SenpiHostProtocolInfo; readonly ensureError?: Error } = {}) {
  const ensured: EnsureHostInput[] = []
  const port: TaskDaemonHostPort = {
    engineBuildIdentity: () => ({ text: ENGINE_TEXT, ordinal: [2026, 9, 18, 0, 1_758_000_000], scheme: "epoch" }),
    probeHost: async () => options.host,
    decideHostAction: (): HostDecision =>
      options.host === undefined
        ? { action: "start", reason: "no_host", upgradeable: false }
        : { action: "reuse", reason: "compatible", upgradeable: false },
    ensureHost: async (input) => {
      ensured.push(input)
      if (options.ensureError !== undefined) throw options.ensureError
      return { pid: 7, socket: input.socket, reused: options.host !== undefined }
    },
  }
  return { port, ensured }
}

function shardFixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "dh-t7-daemon-"))
  dirs.push(agentDir)
  const root = join(agentDir, "rpc", "shards")
  const key = shardKey("p", `root-${agentDir}`)
  return { agentDir, root, key, socket: shardSocketPathForKey(root, "p", key), meta: shardMetaPath(root, "p", key) }
}

function ensureOn(agentDir: string, socket: string, port: TaskDaemonHostPort, owner?: { readonly ownerSessionId: string; readonly key: string }) {
  return ensureTaskDaemon({
    agentDir,
    env: DAEMON_LAUNCH_FIXTURE.parentEnv,
    policy: "upgrade",
    socket,
    ...(owner === undefined ? {} : { owner: { kind: "p", key: owner.key, ownerSessionId: owner.ownerSessionId } }),
    ports: {
      host: port,
      launchSpec: { path: DAEMON_LAUNCH_FIXTURE.specPath, spec: DAEMON_LAUNCH_FIXTURE.spec },
      platform: "darwin",
      bunRuntimeAvailable: true,
    },
  })
}

describe("ensureTaskDaemon on an explicit shard endpoint", () => {
  test("#given no host on a shard socket #when it is ensured with an owner #then that socket is started and its sidecar written with no stores", async () => {
    // given
    const shard = shardFixture()
    const { port, ensured } = hostPort()

    // when
    const result = await ensureOn(shard.agentDir, shard.socket, port, { key: shard.key, ownerSessionId: "root-session" })

    // then
    expect(result.action).toBe("start")
    expect(ensured.map((input) => input.socket)).toEqual([shard.socket])
    expect(JSON.parse(readFileSync(shard.meta, "utf8"))).toMatchObject({
      socket: shard.socket,
      kind: "p",
      root: shard.root,
      owner_session_id: "root-session",
      created_by_pid: process.pid,
      stores: [],
    })
  })

  test("#given a host already listening on the shard #when it is ensured #then it is reused and no sidecar is written", async () => {
    // given
    const shard = shardFixture()
    const { port } = hostPort({ host: running() })

    // when
    const result = await ensureOn(shard.agentDir, shard.socket, port, { key: shard.key, ownerSessionId: "root-session" })

    // then
    expect(result.action).toBe("reuse")
    expect(existsSync(shard.meta)).toBe(false)
  })

  test("#given an engine refusal naming a legacy host #when ensuring #then it is an incompatible host, never a plain ensure failure", async () => {
    // given
    const shard = shardFixture()
    const refusal = Object.assign(new Error("RPC socket refused: legacy_host"), { name: "HostEnsureRefusedError", reason: "legacy_host" })
    const { port } = hostPort({ ensureError: refusal })

    // when
    const failure = await ensureOn(shard.agentDir, shard.socket, port).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("legacy_host")
    expect(isHostIncompatible(failure)).toBe(true)
    expect(isHostIncompatible(new HostUnavailableError("ensure_failed", { fallbackAllowed: false }))).toBe(false)
  })
})
