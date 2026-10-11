import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { RunnerError } from "./in-process/runner-error"
import { isHostSessionHandle } from "./rpc-host"
import { HostUnavailableError } from "./rpc-host/daemon"
import type { HostSessionParked } from "./rpc-host/session-client"
import { readTaskStoreIndex, taskStoreIndexPath } from "./rpc-host/store-index"
import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"
import { cleanupTempDirs, ensureRecorder, posixShardTest, shardEndpoint, tempDir } from "./rpc-host-endpoint.test-support"
import { TRANSPORT_LOST_REASON } from "./rpc-host/transport-recovery"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver } = harness

afterEach(async () => {
  await harness.release()
  cleanupTempDirs()
})

const NO_WAIT = { reattachDelaysMs: [0, 0, 0, 0, 0], sleep: () => Promise.resolve() } as const

function parkedOnce(handle: unknown): Promise<HostSessionParked> {
  if (!isHostSessionHandle(handle as never)) throw new Error("not a host-session handle")
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the child to park, it never did")), 5_000)
    ;(handle as { onParked(listener: (event: HostSessionParked) => void): () => void }).onParked((event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

function openCount(commands: readonly { readonly type: string }[]): number {
  return commands.filter((command) => command.type === "open_session").length
}

describe("RpcHostRunner opens a child on the endpoint its resolver names", () => {
  posixShardTest("#given a shard resolver #when two children start #then each opens on the shard, records that socket, and the resolver runs once per start", async () => {
    // given
    const host = await fakeHost()
    const shard = shardEndpoint(host, "00000000000000a1")
    const ensure = ensureRecorder()
    let resolved = 0
    const runner = runnerOver(host, { ensureDaemon: ensure.ensure, shardResolver: () => (resolved += 1, shard.resolution()) })

    // when
    const resolvedAtConstruction = resolved
    const first = await runner.start(childSpec())
    const second = await runner.start(childSpec({ task_id: "st_31" }))

    // then
    expect(resolvedAtConstruction).toBe(0)
    expect(resolved).toBe(2)
    expect(ensure.inputs.map((input) => input.socket)).toEqual([shard.socket, shard.socket])
    expect(ensure.inputs[0]?.owner).toEqual({ kind: "p", key: shard.key, ownerSessionId: `root-${shard.key}` })
    for (const handle of [first, second]) {
      expect(isHostSessionHandle(handle) ? handle.hostSession.socket : undefined).toBe(shard.socket)
    }
    await first.terminate()
    await second.terminate()
  })

  posixShardTest("#given a resolution with the alternate-root notice #when two children start #then the notice surfaces once", async () => {
    // given
    const host = await fakeHost()
    const shard = shardEndpoint(host, "00000000000000a2")
    const notices: string[] = []
    const runner = runnerOver(host, {
      ensureDaemon: ensureRecorder().ensure,
      shardResolver: () => shard.resolution("shard_alt_root"),
      onNotice: (token) => notices.push(token),
    })

    // when
    await (await runner.start(childSpec())).terminate()
    await (await runner.start(childSpec({ task_id: "st_31" }))).terminate()

    // then
    expect(notices).toEqual(["host_notice:shard_alt_root"])
  })

  test("#given a revival naming its recorded socket #when it starts #then that socket is ensured, the resolver is never asked, and an incompatible answer never reaches the fallback", async () => {
    // given
    const host = await fakeHost()
    const recorded = shardEndpoint(host, "00000000000000a3")
    const current = shardEndpoint(host, "00000000000000a4")
    const fallback = fakeFallbackRunner()
    let resolved = 0
    const ensure = ensureRecorder((input) =>
      Promise.reject(new HostUnavailableError("capability", { fallbackAllowed: true, detail: String(input.socket) })),
    )
    const runner = runnerOver(host, {
      ensureDaemon: ensure.ensure,
      fallback,
      shardResolver: () => (resolved += 1, current.resolution()),
    })

    // when
    const failure = await runner
      .start(childSpec({ resumeSessionPath: "/tmp/dh-30-state/sessions/st_30/old.jsonl", hostSocket: recorded.socket }))
      .catch((error: unknown) => error)

    // then
    expect(resolved).toBe(0)
    expect(ensure.inputs.map((input) => input.socket)).toEqual([recorded.socket])
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({ kind: "host_unavailable", reason: "host_incompatible" })
    expect(fallback.starts).toEqual([])
    expect(openCount(host.commands)).toBe(0)
  })

  for (const where of ["foreign", "own"] as const) {
    test(`#given a revival on its recorded ${where} socket whose host refuses the open for a missing capability #when it starts #then it parks host_incompatible and is never reopened by the fallback`, async () => {
      // given - the ensure answers (or, for the own endpoint, is skipped); the OPEN is refused
      const host = await fakeHost({ capabilities: [] })
      const recorded = shardEndpoint(host, where === "own" ? "00000000000000a5" : "00000000000000a6")
      const fallback = fakeFallbackRunner()
      const ensure = ensureRecorder()
      const notices: string[] = []
      const runner = runnerOver(host, {
        ensureDaemon: ensure.ensure,
        fallback,
        onNotice: (token, detail) => notices.push(`${token} ${detail ?? ""}`),
        ...(where === "own" ? { ownHostSocket: () => recorded.socket } : {}),
      })

      // when
      const failure = await runner
        .start(childSpec({ resumeSessionPath: "/tmp/dh-30-state/sessions/st_30/old.jsonl", hostSocket: recorded.socket }))
        .catch((error: unknown) => error)

      // then
      expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({ kind: "host_unavailable", reason: "host_incompatible" })
      expect(fallback.starts).toEqual([])
      expect(ensure.inputs.map((input) => input.socket)).toEqual(where === "own" ? [] : [recorded.socket])
      expect(notices).toEqual([`host_unavailable:host_incompatible ${recorded.socket}`])
    })
  }
})

describe("the agent-dir store index is an admission precondition", () => {
  posixShardTest("#given runners for two stores on one shard #when three children open #then the index and the sidecar list exactly the two stores, registered before any ensure or open", async () => {
    // given - an older sidecar without a stores field
    const host = await fakeHost()
    const agentDir = tempDir("dh-t7-agent-")
    const shard = shardEndpoint(host, "00000000000000b1")
    const metaPath = join(shard.dir, `p-${shard.key}.meta.json`)
    writeFileSync(metaPath, JSON.stringify({ socket: shard.socket, kind: "p", root: shard.dir }))
    const indexPath = taskStoreIndexPath(agentDir)
    const stores = ["/p1/.omo/senpi-task", "/tmp/x-store"]
    const seenAtEnsure: string[][] = []
    const opensAtEnsure: number[] = []
    const ensure = ensureRecorder((input) => {
      seenAtEnsure.push(Object.keys(readTaskStoreIndex(indexPath).stores))
      opensAtEnsure.push(openCount(host.commands))
      return Promise.resolve({ action: "reuse", reason: "compatible", socket: input.socket ?? "", pid: 1, reused: true, upgradeable: false })
    })
    const runnerFor = (storeDir: string) =>
      runnerOver(host, { agentDir, storeDir, ensureDaemon: ensure.ensure, shardResolver: () => shard.resolution() })

    // when
    await (await runnerFor(stores[0] ?? "").start(childSpec())).terminate()
    await (await runnerFor(stores[1] ?? "").start(childSpec({ task_id: "st_31" }))).terminate()
    await (await runnerFor(stores[0] ?? "").start(childSpec({ task_id: "st_32" }))).terminate()

    // then
    expect(Object.keys(readTaskStoreIndex(indexPath).stores).sort()).toEqual(stores.map((dir) => resolve(dir)).sort())
    expect(JSON.parse(readFileSync(metaPath, "utf8")).stores).toEqual(stores.map((dir) => resolve(dir)))
    expect(seenAtEnsure[0]).toEqual([resolve(stores[0] ?? "")])
    expect(seenAtEnsure[1]?.sort()).toEqual(stores.map((dir) => resolve(dir)).sort())
    expect(opensAtEnsure).toEqual([0, 1, 2])
  })

  test("#given an unwritable index dir #when a child starts #then it fails store_index_unavailable before any ensure or open, with one notice", async () => {
    // given - <agentDir>/rpc is a FILE, so the index cannot be created under it
    const host = await fakeHost()
    const agentDir = tempDir("dh-t7-agent-")
    writeFileSync(join(agentDir, "rpc"), "not a directory")
    const shard = shardEndpoint(host, "00000000000000b2")
    const ensure = ensureRecorder()
    const notices: string[] = []
    const runner = runnerOver(host, {
      agentDir,
      storeDir: "/p1/.omo/senpi-task",
      ensureDaemon: ensure.ensure,
      shardResolver: () => shard.resolution(),
      onNotice: (token) => notices.push(token),
      fallback: fakeFallbackRunner(),
    })

    // when
    const failures = [
      await runner.start(childSpec()).catch((error: unknown) => error),
      await runner.start(childSpec({ task_id: "st_31" })).catch((error: unknown) => error),
    ]

    // then
    for (const failure of failures) {
      expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({ kind: "host_unavailable", reason: "store_index_unavailable" })
    }
    expect(ensure.inputs).toEqual([])
    expect(openCount(host.commands)).toBe(0)
    expect(notices).toEqual(["host_notice:store_index_unavailable"])
  })

  posixShardTest("#given a sidecar the runner cannot write but a writable index #when children open #then they open and the failure is noticed once", async () => {
    // given - the shard dir is read-only, so the sidecar lock cannot be taken there
    const host = await fakeHost()
    const agentDir = tempDir("dh-t7-agent-")
    const shard = shardEndpoint(host, "00000000000000b3")
    writeFileSync(join(shard.dir, `p-${shard.key}.meta.json`), JSON.stringify({ socket: shard.socket, stores: [] }))
    chmodSync(shard.dir, 0o500)
    const notices: string[] = []
    const runner = runnerOver(host, {
      agentDir,
      storeDir: "/p1/.omo/senpi-task",
      ensureDaemon: ensureRecorder().ensure,
      shardResolver: () => shard.resolution(),
      onNotice: (token) => notices.push(token),
    })

    // when
    const first = await runner.start(childSpec())
    const second = await runner.start(childSpec({ task_id: "st_31" }))

    // then
    expect(openCount(host.commands)).toBe(2)
    expect(notices).toEqual(["host_notice:store_register_failed"])
    expect(Object.keys(readTaskStoreIndex(taskStoreIndexPath(agentDir)).stores)).toEqual(["/p1/.omo/senpi-task"])
    chmodSync(shard.dir, 0o700)
    await first.terminate()
    await second.terminate()
  })
})

describe("transport recovery reattaches ONLY on the recorded socket", () => {
  posixShardTest("#given a child whose resolver now names a different shard #when its daemon dies and returns #then the reattach ensures the recorded socket", async () => {
    // given
    const host = await fakeHost()
    const recorded = shardEndpoint(host, "00000000000000c1")
    const moved = shardEndpoint(host, "00000000000000c2")
    const ensure = ensureRecorder()
    let current = recorded
    const runner = runnerOver(host, { ...NO_WAIT, ensureDaemon: ensure.ensure, shardResolver: () => current.resolution() })
    const handle = await runner.start(childSpec())
    current = moved

    // when
    const reprompted = host.waitForCommand("prompt")
    await host.restart()
    await reprompted

    // then
    expect(ensure.inputs.map((input) => input.socket)).toEqual([recorded.socket, recorded.socket])
    expect(isHostSessionHandle(handle) ? handle.hostSession.socket : undefined).toBe(recorded.socket)
    await handle.terminate()
  })

  posixShardTest("#given a recorded host that fails every ensure for a non-incompatibility reason #when the retries are exhausted #then the child ends crashed with transport lost", async () => {
    // given
    const host = await fakeHost()
    const recorded = shardEndpoint(host, "00000000000000c3")
    const ensure = ensureRecorder((input, call) =>
      call === 1
        ? Promise.resolve({ action: "reuse", reason: "compatible", socket: input.socket ?? "", pid: 1, reused: true, upgradeable: false })
        : Promise.reject(new HostUnavailableError("ensure_failed", { fallbackAllowed: false })),
    )
    const runner = runnerOver(host, { ...NO_WAIT, ensureDaemon: ensure.ensure, shardResolver: () => recorded.resolution() })
    const handle = await runner.start(childSpec())

    // when
    host.crash()

    // then
    expect(await handle.waitForExit()).toMatchObject({ kind: "crashed", facts: { stderrTail: TRANSPORT_LOST_REASON } })
    expect(ensure.inputs.map((input) => input.socket)).toEqual(Array.from({ length: 6 }, () => recorded.socket))
  })

  posixShardTest("#given a recorded host that answers incompatibly after a connection cut #when the child reattaches #then it parks host_incompatible, opens nowhere else, and notices once", async () => {
    // given
    const host = await fakeHost()
    const recorded = shardEndpoint(host, "00000000000000c4")
    const elsewhere = shardEndpoint(host, "00000000000000c5")
    const notices: string[] = []
    const ensure = ensureRecorder((input, call) =>
      call === 1
        ? Promise.resolve({ action: "reuse", reason: "compatible", socket: input.socket ?? "", pid: 1, reused: true, upgradeable: false })
        : Promise.reject(new HostUnavailableError("protocol", { fallbackAllowed: false })),
    )
    let current = recorded
    const runner = runnerOver(host, {
      ...NO_WAIT,
      ensureDaemon: ensure.ensure,
      shardResolver: () => current.resolution(),
      onNotice: (token, detail) => notices.push(`${token} ${detail ?? ""}`),
    })
    const handle = await runner.start(childSpec())
    current = elsewhere
    const parked = parkedOnce(handle)

    // when
    host.cutConnections()

    // then
    expect(await parked).toMatchObject({ reason: "host_incompatible" })
    expect(ensure.inputs.map((input) => input.socket)).toEqual([recorded.socket, recorded.socket])
    expect(openCount(host.commands)).toBe(1)
    expect(handle.exitOutcome()).toBeUndefined()
    expect(notices).toEqual([`host_unavailable:host_incompatible ${recorded.socket}`])
  })

  posixShardTest("#given a child whose store index turns unreadable #when its transport is lost #then the reattach parks store_index_unavailable before any ensure or reopen", async () => {
    // given
    const host = await fakeHost()
    const agentDir = tempDir("dh-t7-agent-")
    const recorded = shardEndpoint(host, "00000000000000c6")
    const ensure = ensureRecorder()
    const runner = runnerOver(host, {
      ...NO_WAIT,
      agentDir,
      storeDir: "/p1/.omo/senpi-task",
      ensureDaemon: ensure.ensure,
      shardResolver: () => recorded.resolution(),
    })
    const handle = await runner.start(childSpec())
    writeFileSync(taskStoreIndexPath(agentDir), "{not json")
    const parked = parkedOnce(handle)

    // when
    host.cutConnections()

    // then
    expect(await parked).toMatchObject({ reason: "store_index_unavailable" })
    expect(ensure.inputs.map((input) => input.socket)).toEqual([recorded.socket])
    expect(openCount(host.commands)).toBe(1)
  })
})

describe("the session's OWN endpoint is never ensured from inside it", () => {
  posixShardTest("#given the session's own socket spelled through a symlinked directory #when a child starts there #then it is recognised as the own endpoint and never ensured", async () => {
    // given
    const host = await fakeHost()
    const own = shardEndpoint(host, "00000000000000d3")
    const alias = join(tempDir("dh-t7-alias-"), "shards")
    symlinkSync(own.dir, alias)
    const ensure = ensureRecorder()
    const runner = runnerOver(host, {
      ensureDaemon: ensure.ensure,
      shardResolver: () => own.resolution(),
      ownHostSocket: () => join(alias, basename(own.socket)),
    })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(ensure.inputs).toEqual([])
    expect(openCount(host.commands)).toBe(1)
    await handle.terminate()
  })

  posixShardTest("#given a child session spawning on its own shard #when it starts and its host restarts #then it opens and reopens there with zero ensures", async () => {
    // given
    const host = await fakeHost()
    const own = shardEndpoint(host, "00000000000000d1")
    const ensure = ensureRecorder()
    const runner = runnerOver(host, {
      ...NO_WAIT,
      ensureDaemon: ensure.ensure,
      shardResolver: () => own.resolution(),
      ownHostSocket: () => own.socket,
    })
    const handle = await runner.start(childSpec())

    // when
    const reprompted = host.waitForCommand("prompt")
    await host.restart()
    await reprompted

    // then
    expect(ensure.inputs).toEqual([])
    expect(openCount(host.commands)).toBeGreaterThanOrEqual(1)
    expect(handle.exitOutcome()).toBeUndefined()
    await handle.terminate()
  })

  posixShardTest("#given its own shard goes silent #when the child's transport is lost #then it parks own_host_unreachable with zero ensures", async () => {
    // given
    const host = await fakeHost()
    const own = shardEndpoint(host, "00000000000000d2")
    const ensure = ensureRecorder()
    const notices: string[] = []
    const runner = runnerOver(host, {
      ...NO_WAIT,
      ensureDaemon: ensure.ensure,
      shardResolver: () => own.resolution(),
      ownHostSocket: () => own.socket,
      onNotice: (token) => notices.push(token),
    })
    const handle = await runner.start(childSpec())
    const parked = parkedOnce(handle)

    // when
    host.crash()

    // then
    expect(await parked).toMatchObject({ reason: "own_host_unreachable" })
    expect(ensure.inputs).toEqual([])
    expect(notices).toEqual(["host_notice:own_host_unreachable"])
  })
})
