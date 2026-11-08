import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  HostUnavailableError,
  RpcProcessRunner,
  RunnerError,
  shardKey,
  shardSocketPathForKey,
  type EnsureTaskDaemonInput,
  type EnsuredTaskDaemon,
} from "@oh-my-opencode/senpi-task"

import { buildProcessChildRunner } from "./engine-runners"
import { createEngineHostRuntime, type EngineHostRuntimeOverrides } from "./host-execution-mode"
import { TaskRuntimeContext } from "./runtime-context"

const TREE_KEY = "0123456789abcdef"
const CAPABLE = ["multi_session", "extension_events", "session_context", "session_kind", "generation_handoff"]
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function world(input: { readonly sessionId?: string; readonly sessionContext?: Record<string, string>; readonly env?: Record<string, string> }) {
  // A short root: darwin's TMPDIR alone would push the shard past the bind limit onto the alt root.
  const root = mkdtempSync("/tmp/omo-t8-")
  dirs.push(root)
  const agentDir = join(root, "agent")
  const runtime = new TaskRuntimeContext(root)
  if (input.sessionId !== undefined) {
    runtime.captureFrom({ sessionManager: { getSessionId: () => input.sessionId ?? "", getSessionFile: () => join(root, "s.jsonl") } })
  }
  const ensures: EnsureTaskDaemonInput[] = []
  const probes: string[] = []
  let probeAnswer: "silent" | "H1" = "silent"
  const overrides: EngineHostRuntimeOverrides = {
    env: input.env ?? {},
    platform: "darwin",
    agentDir,
    ensureDaemon: (request) => {
      ensures.push(request)
      return Promise.resolve(ensured(request.socket ?? "<unnamed>"))
    },
    probeHost: (socket) => {
      probes.push(socket)
      return Promise.resolve(
        probeAnswer === "silent" ? undefined : { protocolVersion: 1, instanceId: "H1", generation: 1, engineVersion: "x", engineOrdinal: [1], capabilities: CAPABLE },
      )
    },
  }
  const settings = OmoTaskSettingsSchema.parse({ process_runner: "host" })
  const pi = input.sessionContext === undefined ? {} : { sessionContext: input.sessionContext }
  const host = createEngineHostRuntime(settings, runtime, pi, overrides)
  const runner = () =>
    buildProcessChildRunner({
      runtime,
      sharedParentTools: () => [],
      settings,
      platform: "darwin",
      agentDir,
      env: input.env ?? {},
      hostRouting: { ...host.routing, storeDir: join(root, ".omo", "senpi-task") },
    })
  const spec = { task_id: "st_t8", cwd: root, state_dir: join(root, ".omo", "senpi-task"), prompt: "say hi" }
  return { agentDir, runtime, host, runner, spec, ensures, probes, answer: (value: "silent" | "H1") => (probeAnswer = value) }
}

function ensured(socket: string): EnsuredTaskDaemon {
  return { action: "reuse", reason: "compatible", socket, pid: 1, reused: true, upgradeable: false, capabilities: CAPABLE }
}

function refusedEnsure(inputs: EnsureTaskDaemonInput[]) {
  return (request: EnsureTaskDaemonInput) => {
    inputs.push(request)
    return Promise.reject(new HostUnavailableError("ensure_failed", { fallbackAllowed: false }))
  }
}

describe("every session routes its process children to its own shard", () => {
  test("#given an attached session #when the gate settles and the runner starts a child #then both ensure the session's shard with it as owner", async () => {
    // given
    const w = world({ sessionId: "01a0e4ae-root" })
    const expected = shardSocketPathForKey(join(w.agentDir, "rpc", "shards"), "p", shardKey("p", "01a0e4ae-root"))
    const runnerInputs: EnsureTaskDaemonInput[] = []

    // when
    const mode = await w.host.executionModeGate.ensure()
    const runner = buildProcessChildRunner({
      runtime: w.runtime,
      sharedParentTools: () => [],
      settings: OmoTaskSettingsSchema.parse({ process_runner: "host" }),
      platform: "darwin",
      agentDir: w.agentDir,
      env: {},
      hostRouting: { ...w.host.routing, ensureDaemon: refusedEnsure(runnerInputs), storeDir: w.spec.state_dir },
    })
    await runner.start(w.spec).catch(() => undefined)

    // then
    expect(mode).toBe("process")
    for (const input of [w.ensures[0], runnerInputs[0]]) {
      expect(input?.socket).toBe(expected)
      expect(input?.owner?.ownerSessionId).toBe("01a0e4ae-root")
    }
    expect(w.host.shardSocket()).toBe(expected)
  })

  test("#given a child session inside its tree's host #when the gate settles #then the inherited shard is probed and never ensured", async () => {
    // given
    const w = world({ sessionId: "child-session", sessionContext: { role: "child", shard_key: TREE_KEY, tree_key: TREE_KEY } })
    const shard = shardSocketPathForKey(join(w.agentDir, "rpc", "shards"), "p", TREE_KEY)
    w.answer("H1")

    // when
    const mode = await w.host.executionModeGate.ensure()

    // then
    expect(mode).toBe("process")
    expect(w.probes).toEqual([shard])
    expect(w.ensures).toEqual([])
  })

  test("#given a child session whose own host is silent #when a grandchild starts #then own_host_unreachable with zero ensures and zero per-child spawns", async () => {
    // given
    const shardDir = "/tmp/omo-t8-unused"
    const w = world({ sessionId: "child-session", sessionContext: { role: "child", shard_key: TREE_KEY, tree_key: TREE_KEY, host_socket: join(shardDir, `p-${TREE_KEY}.sock`) } })
    const spawned = spyOn(RpcProcessRunner.prototype, "start")

    try {
      // when
      const failure = await w.runner().start(w.spec).catch((error: unknown) => error)

      // then
      expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("own_host_unreachable")
      expect(w.ensures).toEqual([])
      expect(spawned).toHaveBeenCalledTimes(0)
    } finally {
      spawned.mockRestore()
    }
  })

  test("#given a child without tree keys and a desktop socket in the env #when routed #then it keys a fresh shard from its own id, never the env or rpc.sock", async () => {
    // given
    const w = world({ sessionId: "child-own", sessionContext: { role: "child" }, env: { OMO_RPC_SOCKET_PATH: "/tmp/desk.sock", OMO_RPC_SOCKET: "/tmp/op.sock" } })

    // when
    await w.host.executionModeGate.ensure()

    // then
    expect(w.ensures.map((input) => input.socket)).toEqual([
      shardSocketPathForKey(join(w.agentDir, "rpc", "shards"), "p", shardKey("p", "child-own")),
    ])
  })

  test("#given a second session_start with a new id #when the shard is resolved again #then the socket follows the new session", () => {
    // given
    const w = world({ sessionId: "first-session" })
    const before = w.host.shardSocket()

    // when
    w.runtime.captureFrom({ sessionManager: { getSessionId: () => "second-session" } })

    // then
    expect(w.host.shardSocket()).not.toBe(before)
    expect(w.host.shardSocket()).toBe(shardSocketPathForKey(join(w.agentDir, "rpc", "shards"), "p", shardKey("p", "second-session")))
  })

  test("#given no attached session #when a child starts #then it fails shard_identity_missing and nothing is ensured", async () => {
    // given
    const w = world({})

    // when
    const failure = await w.runner().start(w.spec).catch((error: unknown) => error)
    const mode = await w.host.executionModeGate.ensure()

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("shard_identity_missing")
    expect(mode).toBe("in-process")
    expect(w.host.notices.list().some((notice) => notice.startsWith("host_unavailable:shard_identity_missing"))).toBe(true)
    expect(w.ensures).toEqual([])
  })

  test("#given the lifecycle's endpoint port #when it re-ensures a recorded socket #then it goes through the session's ensure with that socket", async () => {
    // given
    const w = world({ sessionId: "01a0e4ae-root" })

    // when
    const verdict = await w.host.hostEndpoint.ensure("/tmp/omo-t8-recorded/rpc.sock")

    // then
    expect(verdict).toBe("ensured")
    expect(w.ensures.map((input) => input.socket)).toEqual(["/tmp/omo-t8-recorded/rpc.sock"])
  })

  test("#given a session inside its tree's host on an engine without host_socket #when the lifecycle and a lost grandchild reach a recorded shard #then both only attach", () => {
    // given
    const inside = world({ sessionContext: { role: "child", shard_key: TREE_KEY, tree_key: TREE_KEY } })
    const root = world({ sessionId: "01a0e4ae-root" })

    // when
    const recorded = "/tmp/omo-t8-recorded/p-0123456789abcdef.sock"

    // then
    expect(inside.host.routing.insideHost()).toBe(true)
    expect(inside.host.hostEndpoint.isOwn(recorded)).toBe(true)
    expect(root.host.routing.insideHost()).toBe(false)
    expect(root.host.hostEndpoint.isOwn(recorded)).toBe(false)
  })
})
