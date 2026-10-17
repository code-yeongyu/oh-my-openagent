import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { createHostEndpointPort } from "../runners/rpc-host/host-endpoint-port"
import { HostUnavailableError, type EnsureTaskDaemonInput } from "../runners/rpc-host/daemon"
import { readOwnHostSocket } from "../runners/rpc-host/own-endpoint"
import type { HostSessionIdentity } from "../state"
import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { LifecycleDeps, RespawnResult } from "./port"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const HOST_PID = 4_242
const OWN_SHARD = "/tmp/dh-t7/shards/p-00000000000000aa.sock"
const OTHER_SHARD = "/tmp/dh-t7/shards/p-00000000000000bb.sock"
const LEGACY_SOCKET = "/tmp/dh-t7/rpc.sock"

const OK: RespawnResult = {
  ok: true,
  handle: {
    task_id: "st_0c000000",
    sessionId: "child",
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: "done" }),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  },
}

/**
 * Endpoints by socket: which answer a probe, and which refuse an ensure as incompatible. `ensures`
 * records every socket the injected ensure was asked for - the count the own-endpoint guard pins.
 */
class EndpointWorld {
  readonly answering = new Set<string>()
  readonly incompatible = new Set<string>()
  readonly ensures: string[] = []
  readonly notices: string[] = []
  readonly lockSeenDuringEnsure: boolean[] = []

  constructor(private readonly store: TaskRecordStore) {}

  ensureDaemon = (input: EnsureTaskDaemonInput) => {
    const socket = input.socket ?? "<unnamed>"
    this.ensures.push(socket)
    this.lockSeenDuringEnsure.push(existsSync(join(this.store.stateDir, "locks", "session-parent-1.lock")))
    if (this.incompatible.has(socket)) return Promise.reject(new HostUnavailableError("protocol", { fallbackAllowed: false }))
    this.answering.add(socket)
    return Promise.resolve({ action: "start" as const, reason: "no_host", socket, pid: 7, reused: false, upgradeable: false })
  }
}

function endpointDeps(store: TaskRecordStore, world: EndpointWorld, ownHostSocket: string | undefined) {
  const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID, respawn: () => Promise.resolve(OK) })
  const pi = { sessionContext: { role: "child", shard_key: "aa", tree_key: "aa", ...(ownHostSocket === undefined ? {} : { host_socket: ownHostSocket }), host_instance: "H1" } }
  const deps: LifecycleDeps = {
    ...fixture.deps,
    hostSessionProbe: {
      daemonAlive: (identity) => Promise.resolve(world.answering.has(identity.socket)),
      sessionLive: () => Promise.resolve(false),
      sessionLiveness: () => Promise.resolve("gone" as const),
      refresh: () => undefined,
    },
    hostEndpoint: createHostEndpointPort({
      agentDir: "/tmp/dh-t7/agent",
      env: {},
      policy: "upgrade",
      ensureDaemon: world.ensureDaemon,
      ownHostSocket: () => readOwnHostSocket(pi),
      insideHost: () => false,
      onNotice: (token, detail) => world.notices.push(`${token} ${detail ?? ""}`.trim()),
    }),
  }
  return { fixture, lifecycle: createTaskLifecycle(deps) }
}

function seedParked(store: TaskRecordStore, taskId: string, identity: HostSessionIdentity): void {
  seedRecord(store, { ...hostSessionRecordInput(taskId, identity), status: "running", residency_state: "rpc_detached" })
}

function seedOrphan(store: TaskRecordStore, taskId: string, identity: HostSessionIdentity): void {
  seedRecord(store, {
    ...hostSessionRecordInput(taskId, identity),
    parent_session_id: "other-session",
    status: "running",
    residency_state: "resident",
    host_pid: 9_999,
  })
}

describe("revival reaches the RECORDED endpoint and only it", () => {
  test("#given a parked child on a silent shard socket #when session-start revival runs #then that socket is ensured outside the admission lease and the child is revived", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { fixture, lifecycle } = endpointDeps(store, world, undefined)
    seedParked(store, "st_0c000001", hostSession("st_0c000001", { socket: OTHER_SHARD }))

    // when
    await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(world.ensures).toEqual([OTHER_SHARD])
    expect(world.lockSeenDuringEnsure).toEqual([false])
    expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000001"])
  })

  test("#given a daemon-hosted orphan whose host is gone #when the crash sweep reconciles it #then the recorded socket is ensured once and the child revived", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { fixture, lifecycle } = endpointDeps(store, world, undefined)
    seedOrphan(store, "st_0c000002", hostSession("st_0c000002", { socket: OTHER_SHARD }))

    // when
    await lifecycle.reconcileOnSessionStart()

    // then
    expect(world.ensures).toEqual([OTHER_SHARD])
    expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000002"])
    expect(store.load("st_0c000002")?.suspension_reason).toBeUndefined()
  })

  test("#given a pre-migration child on the legacy socket #when it is revived #then the legacy socket is the one ensured", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { lifecycle } = endpointDeps(store, world, undefined)
    seedParked(store, "st_0c000003", hostSession("st_0c000003", { socket: LEGACY_SOCKET }))

    // when
    await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(world.ensures).toEqual([LEGACY_SOCKET])
  })

  test("#given a recorded host that answers incompatibly #when revival runs #then the child is parked host_incompatible, noticed once, and opened nowhere", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    world.incompatible.add(OTHER_SHARD)
    const { fixture, lifecycle } = endpointDeps(store, world, undefined)
    seedParked(store, "st_0c000004", hostSession("st_0c000004", { socket: OTHER_SHARD }))

    // when
    const result = await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(result.outcomes).toContainEqual({ task_id: "st_0c000004", kind: "deferred", reason: "host_incompatible" })
    expect(world.ensures).toEqual([OTHER_SHARD])
    expect(fixture.respawned).toEqual([])
    expect(store.load("st_0c000004")?.residency_state).toBe("rpc_detached")
    expect(store.load("st_0c000004")?.suspension_reason).toBe("host_incompatible")
    expect(world.notices).toEqual([`host_unavailable:host_incompatible ${OTHER_SHARD}`])
  })

  test("#given the store index could not be written #when the respawn reports it #then revival defers store_index_unavailable and parks the record with that reason", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    world.answering.add(OTHER_SHARD)
    const fixture = hostLifecycleDeps({
      store,
      hostPid: HOST_PID,
      respawn: () => Promise.resolve({ ok: false, disposition: "retryable", code: "store_index_unavailable", reason: "index" }),
    })
    const lifecycle = createTaskLifecycle({
      ...fixture.deps,
      hostSessionProbe: { daemonAlive: () => Promise.resolve(true), sessionLive: () => Promise.resolve(false), sessionLiveness: () => Promise.resolve("gone"), refresh: () => undefined },
    })
    seedParked(store, "st_0c000005", hostSession("st_0c000005", { socket: OTHER_SHARD }))

    // when
    const result = await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(result.outcomes).toContainEqual({ task_id: "st_0c000005", kind: "deferred", reason: "store_index_unavailable" })
    expect(store.load("st_0c000005")?.residency_state).toBe("rpc_detached")
    expect(store.load("st_0c000005")?.suspension_reason).toBe("store_index_unavailable")
  })
})

describe("the session's OWN endpoint is never ensured from inside it", () => {
  for (const generation of ["H1", "H2"]) {
    test(`#given this session's own shard answering as generation ${generation} #when its child is revived #then it is revived with zero ensures`, async () => {
      // given - H2 is the successor after a handoff; the guard is a path comparison, not an instance one
      const store = tempStore()
      const world = new EndpointWorld(store)
      world.answering.add(OWN_SHARD)
      const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
      seedParked(store, "st_0c000010", hostSession("st_0c000010", { socket: OWN_SHARD, instance_id: generation }))

      // when
      await lifecycle.reconcileOnSessionStart("parent-1")

      // then
      expect(world.ensures).toEqual([])
      expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000010"])
    })
  }

  test("#given this session's own shard silent #when its child is revived #then it defers own_host_unreachable with zero ensures and zero opens", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
    seedParked(store, "st_0c000011", hostSession("st_0c000011", { socket: OWN_SHARD }))

    // when
    const result = await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(result.outcomes).toContainEqual({ task_id: "st_0c000011", kind: "deferred", reason: "own_host_unreachable" })
    expect(world.ensures).toEqual([])
    expect(fixture.respawned).toEqual([])
    expect(store.load("st_0c000011")?.suspension_reason).toBe("own_host_unreachable")
    expect(world.notices).toEqual([`host_notice:own_host_unreachable ${OWN_SHARD}`])
  })

  test("#given a child recorded on a DIFFERENT, silent shard in the same session #when it is revived #then that shard is ensured", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
    seedParked(store, "st_0c000012", hostSession("st_0c000012", { socket: OTHER_SHARD }))

    // when
    await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(world.ensures).toEqual([OTHER_SHARD])
    expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000012"])
  })

  test("#given the crash sweep meets an orphan on this session's own silent shard #when it reconciles #then it parks own_host_unreachable without an ensure", async () => {
    // given
    const store = tempStore()
    const world = new EndpointWorld(store)
    const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
    seedOrphan(store, "st_0c000013", hostSession("st_0c000013", { socket: OWN_SHARD }))

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes).toContainEqual({ task_id: "st_0c000013", kind: "deferred", reason: "own_host_unreachable" })
    expect(world.ensures).toEqual([])
    expect(fixture.respawned).toEqual([])
  })

  describe("parkHostSessionOnDaemonLoss", () => {
    function seedResident(store: TaskRecordStore, taskId: string, socket: string): void {
      seedRecord(store, {
        ...hostSessionRecordInput(taskId, hostSession(taskId, { socket })),
        status: "running",
        residency_state: "resident",
        host_pid: HOST_PID,
      })
    }

    for (const generation of ["H1", "H2"]) {
      test(`#given the own shard answering as ${generation} #when the child is parked on daemon loss #then it revives with zero ensures`, async () => {
        // given
        const store = tempStore()
        const world = new EndpointWorld(store)
        world.answering.add(OWN_SHARD)
        const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
        seedResident(store, "st_0c000020", OWN_SHARD)

        // when
        const outcome = await lifecycle.parkHostSessionOnDaemonLoss("st_0c000020")

        // then
        expect(outcome).toEqual({ kind: "revived" })
        expect(world.ensures).toEqual([])
        expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000020"])
      })
    }

    test("#given the own shard silent #when the child is parked on daemon loss #then it stays suspended own_host_unreachable with zero ensures and zero opens", async () => {
      // given
      const store = tempStore()
      const world = new EndpointWorld(store)
      const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
      seedResident(store, "st_0c000021", OWN_SHARD)

      // when
      const outcome = await lifecycle.parkHostSessionOnDaemonLoss("st_0c000021")

      // then
      expect(outcome).toEqual({ kind: "suspended", reason: "own_host_unreachable" })
      expect(world.ensures).toEqual([])
      expect(fixture.respawned).toEqual([])
      expect(store.load("st_0c000021")?.suspension_reason).toBe("own_host_unreachable")
      expect(world.notices).toEqual([`host_notice:own_host_unreachable ${OWN_SHARD}`])
    })

    test("#given a different, silent shard #when the child is parked on daemon loss #then that shard is ensured once and the child revives", async () => {
      // given
      const store = tempStore()
      const world = new EndpointWorld(store)
      const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
      seedResident(store, "st_0c000022", OTHER_SHARD)

      // when
      const outcome = await lifecycle.parkHostSessionOnDaemonLoss("st_0c000022")

      // then
      expect(outcome).toEqual({ kind: "revived" })
      expect(world.ensures).toEqual([OTHER_SHARD])
      expect(fixture.respawned.map((entry) => entry.task_id)).toEqual(["st_0c000022"])
    })

    test("#given an incompatible recorded host #when the child is parked on daemon loss #then it stops retrying and stays suspended host_incompatible", async () => {
      // given
      const store = tempStore()
      const world = new EndpointWorld(store)
      world.incompatible.add(OTHER_SHARD)
      const { fixture, lifecycle } = endpointDeps(store, world, OWN_SHARD)
      seedResident(store, "st_0c000023", OTHER_SHARD)

      // when
      const outcome = await lifecycle.parkHostSessionOnDaemonLoss("st_0c000023")

      // then
      expect(outcome).toEqual({ kind: "suspended", reason: "host_incompatible" })
      expect(world.ensures).toEqual([OTHER_SHARD])
      expect(fixture.waits).toEqual([1_000])
      expect(fixture.respawned).toEqual([])
    })
  })
})
