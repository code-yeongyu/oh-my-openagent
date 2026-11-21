import { describe, expect, test } from "bun:test"
import { withContractHost, type ContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import type { SessionWatchHandlers } from "./control/wait-settled"
import { createLazyLiveThreadSurface } from "./lazy-live-surface"
import { createLiveThreadSurface } from "./live-surface"
import type { RemoteStatusChange } from "./remote/ports"

function watch(host: ContractHost, handlers: SessionWatchHandlers) {
  const client = createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined,
    registry: async () => [],
  })
  if (client.watchSession === undefined) throw new Error("watchSession is missing")
  return client.watchSession("rpc-1", handlers, "dur-selected")
}

function collector() {
  const seen: Array<{ readonly record?: unknown; readonly status?: RemoteStatusChange }> = []
  const waiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  const note = (entry: (typeof seen)[number]) => {
    seen.push(entry)
    for (const waiter of waiters.filter((candidate) => seen.length >= candidate.count)) waiter.resolve()
  }
  const handlers: SessionWatchHandlers = {
    record: (record) => note({ record }),
    status: (status) => note({ status }),
  }
  const next = (count: number) =>
    seen.length >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waiters.push({ count, resolve })
        })
  return { seen, handlers, next }
}

const sentTypes = (host: ContractHost) =>
  host.frames.map(({ frame }) => frame.type).filter((type) => type !== "get_protocol_info" && type !== "authenticate")

describe("thread_read wait on this device: the endpoint's observing session subscription", () => {
  test("#given an idle session #when it is watched and a run starts and ends #then the watch starts idle, reports each status change and the run's records of that session only, and never attaches", async () => {
    await withContractHost({ auth: true }, async (host) => {
      const { seen, handlers, next } = collector()
      const outcome = await watch(host, handlers)
      if (outcome.kind !== "ok") throw new Error(`watch refused: ${outcome.reason}`)
      expect(outcome.watch.initial).toEqual({ status: "idle" })
      host.publish([
        { type: "agent_start", turnId: "7", sessionId: "rpc-2" },
        { type: "agent_start", turnId: "7" },
        { type: "message_update" },
        { type: "session_status", status: "running", lastChange: { cause: "prompt" } },
        { type: "agent_settled", turnId: "7" },
        { type: "session_status", status: "idle", lastChange: { cause: "agent_end" } },
      ])
      await next(4)
      expect(seen).toEqual([
        { record: { type: "agent_start", turnId: "7", sessionId: "rpc-1" } },
        { status: { from: "idle", to: "running", derived: false, cause: "prompt" } },
        { record: { type: "agent_settled", turnId: "7", sessionId: "rpc-1" } },
        { status: { from: "running", to: "idle", derived: false, cause: "agent_end" } },
      ])
      const subscribe = host.frames.find(({ frame }) => frame.type === "subscribe_sessions")?.frame
      expect(subscribe).toMatchObject({ sessions: { ids: ["rpc-1"] }, observe: true })
      expect(subscribe?.mirror).toContain("agent_settled")
      expect(subscribe?.mirror).not.toContain("message_update")
      expect(sentTypes(host)).toEqual(["subscribe_sessions", "get_state"])
      // The turn-id read observes: a waiting read never counts as an attached client (#14061 review B1).
      expect(host.frames.find(({ frame }) => frame.type === "get_state")?.frame).toMatchObject({ observe: true })
      outcome.watch.stop()
      expect(await outcome.watch.ended).toBe("stopped")
    })
  })

  test("#given records the host writes right behind the subscription's answer #when the watch opens #then they are applied after the snapshot, as changes from its status", async () => {
    await withContractHost(
      { auth: true, subscribeStatus: "running", afterSubscribe: [{ type: "session_status", status: "idle" }] },
      async (host) => {
        const { seen, handlers, next } = collector()
        const outcome = await watch(host, handlers)
        await next(1)
        expect(outcome).toMatchObject({ kind: "ok", watch: { initial: { status: "running" } } })
        expect(seen).toEqual([{ status: { from: "running", to: "idle", derived: false } }])
      },
    )
  })

  test("#given a session already running #when it is watched #then the watch starts at its running turn, read from get_state, and the run's settle carries that turn", async () => {
    await withContractHost({ auth: true, subscribeStatus: "running", currentTurnId: "3" }, async (host) => {
      const { seen, handlers, next } = collector()
      const outcome = await watch(host, handlers)
      expect(outcome).toMatchObject({ kind: "ok", watch: { initial: { status: "running", currentTurnId: "3" } } })
      host.publish([{ type: "agent_settled" }])
      await next(1)
      expect(seen).toEqual([{ record: { type: "agent_settled", sessionId: "rpc-1", turnId: "3" } }])
    })
  })

  test.each([
    ["is the run the stream saw start", "run-a", { turnId: "5" }],
    ["belongs to a later run that began meanwhile", "run-b", {}],
  ] as const)(
    "#given a run that starts and settles before its turn read lands #when the read's run %s #then the settle carries that turn only when the runs match (fast-run race)",
    async (_label, readRun, stamp) => {
      const state = { isStreaming: true, currentTurnId: readRun === "run-a" ? "5" : "9", lifecycle: { runId: readRun } }
      await withContractHost({ auth: true, state }, async (host) => {
        const { seen, handlers, next } = collector()
        await watch(host, handlers)
        host.publish([
          { type: "agent_start", runId: "run-a" },
          { type: "session_status", status: "running" },
          { type: "agent_settled" },
          { type: "session_status", status: "idle" },
        ])
        await next(4)
        expect(seen[2]).toEqual({ record: { type: "agent_settled", sessionId: "rpc-1", ...stamp } })
        expect(seen[3]).toEqual({ status: { from: "running", to: "idle", derived: false } })
      })
    },
  )

  test("#given a running snapshot whose turn read finds the run already over #when no run start was seen #then the watch starts with no turn id", async () => {
    await withContractHost(
      { auth: true, subscribeStatus: "running", state: { isStreaming: false, currentTurnId: "7" } },
      async (host) => {
        const outcome = await watch(host, collector().handlers)
        expect(outcome).toMatchObject({ kind: "ok", watch: { initial: { status: "running" } } })
        expect((outcome as { watch: { initial?: object } }).watch.initial).not.toHaveProperty("currentTurnId")
      },
    )
  })

  test("#given a watched session #when its status becomes closed #then the watch ends session_closed", async () => {
    await withContractHost({ auth: true, subscribeStatus: "running" }, async (host) => {
      const { handlers } = collector()
      const outcome = await watch(host, handlers)
      if (outcome.kind !== "ok") throw new Error(`watch refused: ${outcome.reason}`)
      host.publish([{ type: "session_status", status: "closed" }])
      expect(await outcome.watch.ended).toBe("session_closed")
    })
  })

  test("#given a watched session #when the host ends the connection #then the watch ends connection_closed", async () => {
    await withContractHost({ auth: true }, async (host) => {
      const { handlers } = collector()
      const outcome = await watch(host, handlers)
      if (outcome.kind !== "ok") throw new Error(`watch refused: ${outcome.reason}`)
      host.dropSubscribers()
      expect(await outcome.watch.ended).toBe("connection_closed")
    })
  })

  test("#given a host that refuses the subscription #when the session is watched #then the watch is refused with the host's code", async () => {
    await withContractHost({ auth: true, subscribeRefusal: "invalid_subscription" }, async (host) => {
      expect(await watch(host, collector().handlers)).toEqual({ kind: "refused", reason: "invalid_subscription" })
    })
  })
})

describe("thread_read wait on this device through the component's host (createLazyLiveThreadSurface, component.ts)", () => {
  test.each(["the host itself", "the endpoint that listed the session"] as const)(
    "#given the lazy host the thread component builds #when a session is watched through %s #then the watch opens on the endpoint's subscription and reports its status changes",
    async (via) => {
      await withContractHost({ auth: true }, async (host) => {
        const lazy = createLazyLiveThreadSurface(undefined, {
          env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
          statusAll: async () => undefined,
          registry: async () => [],
          loadRuntime: async () => ({ createLiveThreadSurface }),
        })
        const port = via === "the host itself" ? lazy : lazy.endpoint(host.socket)
        const { seen, handlers, next } = collector()
        const outcome = await port.watchSession?.("rpc-1", handlers, "dur-selected")
        expect(outcome).toMatchObject({ kind: "ok", watch: { initial: { status: "idle" } } })
        host.publish([{ type: "session_status", status: "running" }])
        await next(1)
        expect(seen).toEqual([{ status: { from: "idle", to: "running", derived: false } }])
      })
    },
  )
})
