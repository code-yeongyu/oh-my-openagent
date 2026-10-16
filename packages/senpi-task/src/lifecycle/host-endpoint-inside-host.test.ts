import { afterEach, describe, expect, test } from "bun:test"

import { createHostEndpointPort } from "../runners/rpc-host/host-endpoint-port"
import type { EnsureTaskDaemonInput } from "../runners/rpc-host/daemon"
import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const TREE_SHARD = "/tmp/dh-t8n1/shards/p-00000000000000f1.sock"

describe("a lifecycle running inside a host never ensures a recorded endpoint when host_socket is unknown", () => {
  test("#given an inherited context without host_socket and a parked child on its silent tree shard #when revival runs #then it parks own_host_unreachable with zero ensures", async () => {
    // given - senpi 2026.9.27 stamps no host_socket; the inherited shard_key alone says this process is inside a host
    const store = tempStore()
    const ensures: string[] = []
    const notices: string[] = []
    const fixture = hostLifecycleDeps({ store, hostPid: 5_151, respawn: () => Promise.reject(new Error("must not respawn")) })
    const lifecycle = createTaskLifecycle({
      ...fixture.deps,
      hostSessionProbe: { daemonAlive: () => Promise.resolve(false), sessionLive: () => Promise.resolve(false), sessionLiveness: () => Promise.resolve("gone"), refresh: () => undefined },
      hostEndpoint: createHostEndpointPort({
        agentDir: "/tmp/dh-t8n1/agent",
        env: {},
        policy: "upgrade",
        ensureDaemon: (input: EnsureTaskDaemonInput) => {
          ensures.push(input.socket ?? "<unnamed>")
          return Promise.reject(new Error("an ensure from inside a host spawns a supervisor"))
        },
        ownHostSocket: () => undefined,
        insideHost: () => true,
        onNotice: (token, detail) => notices.push(`${token} ${detail ?? ""}`.trim()),
      }),
    })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0f000001", hostSession("st_0f000001", { socket: TREE_SHARD })),
      status: "running",
      residency_state: "rpc_detached",
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart("parent-1")

    // then
    expect(ensures).toEqual([])
    expect(result.outcomes).toContainEqual({ task_id: "st_0f000001", kind: "deferred", reason: "own_host_unreachable" })
    expect(store.load("st_0f000001")?.suspension_reason).toBe("own_host_unreachable")
    expect(notices).toEqual([`host_notice:own_host_unreachable ${TREE_SHARD}`])
    lifecycle.dispose?.()
  })
})
